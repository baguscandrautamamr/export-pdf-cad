"""Shared engineering core for panel schedule + SLD generation.

Everything that both the XLSX and the DXF builder need lives here so the two
deliverables can never disagree with each other: same phase balancing, same
breaker selection, same totals. Import it, don't reimplement it.
"""
import json, math, os, re

SQRT3 = 1.732

# IEC 60947-2 / 60898 preferred ratings. Selection always rounds UP to one of these.
STD_BREAKER = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160,
               200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600]

# IEC 60364-5-52 Table B.52.5 - Cu/XLPE 90C, 3 loaded conductors, 30C ambient.
# Method E = multicore in free air / on perforated tray. Deliberately conservative:
# manufacturer data (VDE 0276 / HD 603 / BS 7671) is usually higher, so a design
# that passes on these numbers also passes on the real cable datasheet.
IZ_CU_XLPE_E = {2.5: 30, 4: 40, 6: 51, 10: 70, 16: 94, 25: 119, 35: 147,
                50: 179, 70: 229, 95: 283, 120: 327, 150: 376, 185: 428,
                240: 506, 300: 579, 400: 656}
# Conductor resistance at 90 C (ohm/km) - R20 x 1.275
R90_CU = {2.5: 9.45, 4: 5.87, 6: 3.91, 10: 2.33, 16: 1.47, 25: 0.927, 35: 0.668,
          50: 0.494, 70: 0.342, 95: 0.246, 120: 0.195, 150: 0.158, 185: 0.126,
          240: 0.096, 300: 0.0766, 400: 0.0594}
X_CU = 0.08  # ohm/km, typical for multicore LV cable

# Ambient correction Ca for XLPE (IEC 60364-5-52 Table B.52.14)
CA_XLPE = {25: 1.02, 30: 1.00, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76}


def std_breaker(amps, minimum=6):
    """Smallest preferred rating >= amps (and >= minimum)."""
    for r in STD_BREAKER:
        if r >= max(amps, minimum):
            return r
    return STD_BREAKER[-1]


def load_config(path):
    with open(path, encoding='utf-8') as f:
        cfg = json.load(f)
    sysd = cfg.setdefault('system', {})
    sysd.setdefault('voltage_ll', 400)
    sysd.setdefault('voltage_ln', 230)
    sysd.setdefault('pf', 0.8)
    sysd.setdefault('ambient_c', 40)
    sysd.setdefault('cable_length_m', 100)
    sysd.setdefault('spare_percent', 20)
    sysd.setdefault('spare_circuits', 3)
    sysd.setdefault('vd_limit', 0.04)
    sysd.setdefault('min_mcb_1p', 16)
    sysd.setdefault('cg_out', 0.80)      # grouping factor for outgoing circuits on tray
    sysd.setdefault('cable_headroom', 1.25)  # outgoing cable sized above the breaker
    sysd.setdefault('min_cable_mm2', 4)      # practical minimum for a panel outgoing
    sysd.setdefault('motor_pf', 0.85)    # typical LV induction motor
    sysd.setdefault('motor_eff', 0.88)
    sysd.setdefault('ca', CA_XLPE.get(int(sysd['ambient_c']), 0.91))
    cfg.setdefault('panel', {})
    return cfg


def expand(loads):
    """qty>1 becomes qty separate circuits (.01, .02 ...) unless split=false.

    Equipment schedules list identical units on one line; a panel schedule has to
    show one breaker per unit, so expansion is the default.
    """
    out = []
    for it in loads:
        q = int(it.get('qty', 1))
        if q > 1 and it.get('split', True):
            for k in range(1, q + 1):
                d = dict(it)
                d['tag'] = f"{it['tag']}.{k:02d}"
                d['qty'] = 1
                out.append(d)
        else:
            d = dict(it)
            if q > 1:
                d['watt'] = it['watt'] * q
            out.append(d)
    return out


def balance(rows):
    """Assign each 1-phase circuit to R, S or T, largest load first onto the
    lightest phase. Round-robin looks tidy but leaves the biggest single-phase
    loads stacked; largest-first is what actually drives imbalance down.
    Returns the single-phase watts carried by each phase.
    """
    load = {'R': 0.0, 'S': 0.0, 'T': 0.0}
    for r in sorted([r for r in rows if r['phase'] == 1], key=lambda z: -z['watt']):
        k = min(load, key=lambda z: (load[z], z))
        r['ph'] = k
        load[k] += r['watt']
    return load


def size_circuit(r, sysd):
    """Breaker + outgoing cable for one circuit.

    Two currents are in play and mixing them up is the classic mistake:

    * The Ampere column of a panel schedule is a *demand* figure - watts divided
      by the panel's blanket power factor. It is what the busbar and incoming see.
    * A motor's full load ampere is higher than that, because the motor's own
      efficiency and power factor sit between the shaft kW and the line current.

    Protection has to be sized on FLA, not on the demand figure, otherwise an
    11 kW fan gets a 25 A breaker where its nameplate says 22 A and it trips on
    start. The 1.25 factor then covers starting; the overload relay inside the DOL
    starter - not the breaker - provides the motor's thermal protection.

    Outgoing cables are derated for grouping (cg_out) because circuits leaving a
    panel are bunched together on the same tray, which is exactly the condition
    the grouping factor exists for, then sized a further cable_headroom above the
    breaker and never below min_cable_mm2. Iz >= In alone is the bare legal
    minimum; it leaves a 16 A circuit on 2,5 mm2, which no one actually installs
    because it has no room for volt drop over a long branch, no allowance for a
    future load change, and poor mechanical robustness in a busy tray.
    """
    w, p = r['watt'], r['phase']
    k = sysd['ca'] * sysd['cg_out']
    need = lambda rating: rating * sysd['cable_headroom']
    floor = sysd['min_cable_mm2']
    if p == 3:
        r['amp'] = w / (sysd['voltage_ll'] * SQRT3 * sysd['pf'])
        r['motor'] = bool(r.get('motor', True))
        if r['motor']:
            fla = w / (sysd['voltage_ll'] * SQRT3 * sysd['motor_pf'] * sysd['motor_eff'])
            rating = std_breaker(fla * 1.25, 16)
        else:
            rating = std_breaker(r['amp'] * 1.25, 16)
        r['breaker'] = f"{'MCCB' if rating >= 32 else 'MCB'} 3P, {rating}A"
        mm2 = next(s for s in sorted(IZ_CU_XLPE_E)
                   if s >= floor and IZ_CU_XLPE_E[s] * k >= need(rating))
        r['cable'] = f"NYY 5C x {fmt_mm2(mm2)}mm2"
    else:
        r['amp'] = w / sysd['voltage_ln']
        r['motor'] = False
        rating = std_breaker(r['amp'] * 1.25, sysd['min_mcb_1p'])
        r['breaker'] = f"MCB 1P, {rating}A"
        mm2 = next(s for s in sorted(IZ_CU_XLPE_E)
                   if s >= floor and IZ_CU_XLPE_E[s] * k >= need(rating))
        r['cable'] = f"NYY 3C x {fmt_mm2(mm2)}mm2"
    r['breaker_rating'] = rating
    r['cable_mm2'] = mm2
    return r


def fmt_mm2(v):
    return f"{v:g}".replace('.', ',')


def build(cfg):
    """Full model: circuits, phase totals, incoming sizing, cable options."""
    sysd = cfg['system']
    rows = expand(cfg['loads'])
    for i, r in enumerate(rows):
        r['no'] = i + 1
        r['phase'] = int(r.get('phase', 1))
        r.setdefault('desc', '')
    single = balance(rows)
    for r in rows:
        size_circuit(r, sysd)

    three = sum(r['watt'] for r in rows if r['phase'] == 3) / 3.0
    phase_w = {k: single[k] + three for k in ('R', 'S', 'T')}
    total_w = sum(r['watt'] for r in rows)
    va = total_w / sysd['pf']
    amp = va / (SQRT3 * sysd['voltage_ll'])
    design = amp * 1.1
    incoming = std_breaker(design, 16)
    mx, mn = max(phase_w.values()), min(phase_w.values())
    imbalance = (mx - mn) / (sum(phase_w.values()) / 3) if total_w else 0.0

    res = dict(rows=rows, phase_w=phase_w, single=single, total_w=total_w, va=va,
               amp=amp, design=design, incoming=incoming, imbalance=imbalance,
               spare_w=total_w * sysd['spare_percent'] / 100.0, sys=sysd,
               panel=cfg['panel'])
    res['cables'] = cable_options(res)
    return res


def cable_options(res):
    """Feeder alternatives that satisfy Iz >= In and the voltage-drop limit.

    Offering several is not indecision: single-run is compact, parallel runs are
    far easier to pull and terminate, aluminium is cheaper. The engineer picks
    based on tray space and budget, so give them the numbers to choose with.
    """
    s = res['sys']
    In, Ib, L = res['incoming'], res['design'], s['cable_length_m']
    pf = s['pf']
    sinphi = math.sqrt(max(0.0, 1 - pf * pf))
    sizes = sorted(IZ_CU_XLPE_E)

    def option(runs, cg, mm2):
        iz = IZ_CU_XLPE_E[mm2] * s['ca'] * cg * runs
        vd = SQRT3 * Ib * (L / 1000.0) * (R90_CU[mm2] * pf + X_CU * sinphi) / runs
        return dict(runs=runs, mm2=mm2, iz=iz, vd=vd, pct=vd / s['voltage_ll'],
                    ok=vd / s['voltage_ll'] <= s['vd_limit'],
                    desc=(f"{runs} x NYY/N2XY 4C x {fmt_mm2(mm2)} mm2 (Cu/XLPE)"
                          + (" paralel" if runs > 1 else "")))

    def smallest(runs, cg, floor=0):
        for mm2 in sizes:
            if mm2 >= floor and IZ_CU_XLPE_E[mm2] * s['ca'] * cg * runs >= In:
                return mm2
        return None

    opts = []
    base = smallest(1, 1.00)
    if base is None:
        return opts
    opts.append(option(1, 1.00, base))
    bigger = [x for x in sizes if x > base]
    if bigger:
        opts.append(option(1, 1.00, bigger[0]))          # extra margin

    # Parallel runs are only worth proposing once a single cable becomes awkward
    # to handle - roughly 95 mm2 and up, where bending radius and lug size start
    # to dictate the installation. Below that, two cables just double the
    # terminations for no benefit.
    if base >= 95:
        p2 = smallest(2, 0.88, 50)
        if p2:
            opts.append(option(2, 0.88, p2))
            bigger2 = [x for x in sizes if x > p2]
            if bigger2:
                opts.append(option(2, 0.88, bigger2[0]))

    # Busduct only becomes competitive at serious current; below that it is an
    # expensive answer to a problem a single cable already solves.
    if In >= 250:
        rating = std_breaker(In * 1.25)
        vd = SQRT3 * Ib * (L / 1000.0) * 0.025
        opts.append(dict(runs=1, mm2=0, iz=float(rating), vd=vd,
                         pct=vd / s['voltage_ll'], ok=True,
                         desc=f"Busduct / busway {rating} A, sandwich type"))
    return opts


def pe_size(mm2):
    """IEC 60364-5-54 Table 54.2."""
    if mm2 <= 16:
        return mm2
    if mm2 <= 35:
        return 16
    return mm2 / 2


def safe_name(s):
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', s).strip('_')
