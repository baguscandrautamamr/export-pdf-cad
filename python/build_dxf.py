#!/usr/bin/env python3
"""loads.json -> DXF panel schedule drawing (vertical SLD + load table) + PDF preview.

Layout follows the standard consultant panel-schedule sheet: vertical busbar on
the left with one horizontal branch per circuit, and the load table on the right
with its rows on the exact same 8 mm grid so every circuit reads straight across.

Usage:  python3 build_dxf.py loads.json [outdir]
"""
import sys, os
import ezdxf
from ezdxf.enums import TextEntityAlignment as TA
from panel_core import load_config, build, safe_name, pe_size, fmt_mm2

RH = 8.0            # row pitch, mm
XB = 150.0          # busbar x
XEND = 412.0        # right end of the SLD branch lines
TX = 418.0          # table left edge
COLS = [('FUNCTION', 88), ('LOAD\nEQUIPMENT', 40), ('kW', 26), ('PHASE', 26),
        ('', 10), ('R', 32), ('S', 32), ('T', 32), ('REMARKS', 40)]


def make(cfg, outdir):
    m = build(cfg)
    p, s = m['panel'], m['sys']
    rows = m['rows']
    nsp = int(s['spare_circuits'])
    NROW = len(rows) + nsp + 1                      # + grand-total row

    W = 841.0
    need = 124 + RH * NROW + 32 + 10 + 86 + 20
    H = 594.0 if need <= 594 else (841.0 if need <= 841 else round(need + 20, 0))

    doc = ezdxf.new('R2010', setup=True)
    doc.header['$INSUNITS'] = 4
    msp = doc.modelspace()
    for n, col, lw in [('BORDER', 7, 0.50), ('TITLE', 7, 0.35), ('BUS', 7, 0.50),
                       ('WIRE', 7, 0.25), ('SYMBOL', 7, 0.25), ('TEXT', 7, 0.18),
                       ('TABLE', 7, 0.25), ('TABLE-H', 7, 0.50), ('NOTE', 7, 0.18)]:
        l = doc.layers.add(n); l.color = col; l.lineweight = int(lw * 100)
    if 'ISO' not in doc.styles:
        doc.styles.add('ISO', font='isocp.shx')

    def L(a, b, ly='WIRE'): msp.add_line(a, b, dxfattribs={'layer': ly})
    def PL(pts, ly='WIRE', close=False): msp.add_lwpolyline(pts, close=close, dxfattribs={'layer': ly})
    def RC(x, y, w, h, ly='SYMBOL'): PL([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], ly, True)
    def CI(x, y, r, ly='SYMBOL'): msp.add_circle((x, y), r, dxfattribs={'layer': ly})
    def X(x, y, sz=0.8, ly='SYMBOL'):
        L((x - sz, y - sz), (x + sz, y + sz), ly); L((x - sz, y + sz), (x + sz, y - sz), ly)
    def T(x, y, t, h=2.2, ly='TEXT', rot=0, al=TA.LEFT):
        e = msp.add_text(str(t), dxfattribs={'layer': ly, 'height': h, 'style': 'ISO', 'rotation': rot})
        e.set_placement((x, y), align=al); return e

    PL([(0, 0), (W, 0), (W, H), (0, H)], 'BORDER', True)
    PL([(15, 15), (W - 15, 15), (W - 15, H - 15), (15, H - 15)], 'BORDER', True)

    Y0 = H - 124.0
    YIN = Y0 + 30.0
    yb = lambda i: Y0 - (i + 1) * RH

    # ---- panel title box ----
    ty = H - 16
    PL([(30, ty - 38), (255, ty - 38), (255, ty), (30, ty)], 'BORDER', True)
    T(37, ty - 10, f"{p.get('name','PANEL')}   ({p.get('ip','IP 42')})", 5, 'TITLE')
    T(37, ty - 18, (f"(LOCATION AT {p['location']})" if p.get('location') else ''), 2.8, 'TITLE')
    RC(37, ty - 35, 11, 11, 'BORDER'); T(42.5, ty - 31.5, '1', 3.6, 'TITLE', al=TA.MIDDLE_CENTER)
    ref = f"REF. {p['reference']}   |   " if p.get('reference') else ''
    T(55, ty - 32, f"{ref}{s['voltage_ll']}/{s['voltage_ln']}V, 3PH+N+PE, 50Hz", 2.6, 'TITLE')

    # ---- incoming ----
    inc_mm2 = next((o['mm2'] for o in m['cables'] if o['ok'] and o['runs'] == 1 and o['mm2']), 240)
    inc_txt = f"NYY 4C x {fmt_mm2(inc_mm2)} mm2 + NYA 1C x {fmt_mm2(pe_size(inc_mm2))} mm2"
    YBOT = yb(NROW - 1) - 6
    PL([(45, YBOT + 60), (45, YIN), (XB, YIN)], 'BUS')
    PL([(45, YBOT + 68), (42, YBOT + 61), (48, YBOT + 61)], 'SYMBOL', True)
    T(30, YBOT + 53, f"FROM  {p.get('source','MDP')}", 2.8, 'TEXT')
    T(41, YBOT + 90, inc_txt, 2.4, 'TEXT', rot=90)
    X(66, YIN); L((68, YIN + 4), (78, YIN - 4), 'SYMBOL'); X(80, YIN)
    for k in range(3):
        L((70 + k * 3, YIN + 2.4), (73 + k * 3, YIN + 3.6), 'SYMBOL')
    T(73, YIN - 11, 'MCCB 3P', 2.6, 'TEXT', al=TA.MIDDLE_CENTER)
    T(73, YIN - 15, f"{m['incoming']}A", 2.6, 'TEXT', al=TA.MIDDLE_CENTER)
    CI(120, YIN + 3, 3.2); CI(124, YIN + 3, 3.2)
    T(122, YIN - 10, 'CT', 2.4, 'TEXT', al=TA.MIDDLE_CENTER)
    T(122, YIN - 14, f"{m['incoming']}/5A", 2.4, 'TEXT', al=TA.MIDDLE_CENTER)
    for nm, dx in (('R', -20), ('Y', -12), ('B', -4)):
        xx = 95 + dx
        CI(xx, YIN + 26, 2.4); T(xx, YIN + 31.5, nm, 2.6, 'TEXT', al=TA.MIDDLE_CENTER)
        L((xx, YIN + 23.6), (xx, YIN + 18), 'WIRE')
    L((75, YIN + 18), (91, YIN + 18)); RC(82, YIN + 10, 6, 4); T(90, YIN + 11, 'F 2A', 2.2)
    L((85, YIN + 10), (85, YIN)); L((75, YIN + 18), (75, YIN))
    RC(100, YIN + 13, 34, 14, 'BORDER')
    T(117, YIN + 22, 'SENTRON', 2.6, 'TEXT', al=TA.MIDDLE_CENTER)
    T(117, YIN + 16, 'PAC 3200', 2.6, 'TEXT', al=TA.MIDDLE_CENTER)
    L((117, YIN + 13), (117, YIN))
    L((100, YIN), (100, YIN - 14)); RC(97, YIN - 24, 6, 10); L((100, YIN - 24), (100, YIN - 32))
    T(92, YIN - 19, 'SA', 2.4, 'TEXT', al=TA.MIDDLE_RIGHT)
    for k, w in enumerate((8, 5, 2.5)):
        L((100 - w / 2, YIN - 32 - k * 2), (100 + w / 2, YIN - 32 - k * 2), 'SYMBOL')
    L((XB, YIN), (XB, YBOT), 'BUS')
    L((XB, YBOT), (XB, YBOT - 8))
    for k, w in enumerate((10, 6, 3)):
        L((XB - w / 2, YBOT - 8 - k * 2.2), (XB + w / 2, YBOT - 8 - k * 2.2), 'SYMBOL')
    T(XB - 4, YBOT + 30, f"{m['incoming']}A, {s['voltage_ll']}V, 3PH, 4W, 50Hz", 2.6, 'TEXT', rot=90)

    # ---- circuit branches ----
    def branch(i, num, brk_txt, cab_txt='', three=False, motor=False):
        y = yb(i)
        L((XB, y + 6.6), (158, y + 6.6)); X(158.5, y + 6.6)
        L((160, y + 7.2), (168, y + 1.4), 'SYMBOL')
        if three:
            for k in range(3):
                L((162.4 + k * 1.7, y + 4.2), (164.4 + k * 1.7, y + 5.6), 'SYMBOL')
        X(169, y + 0.9)
        T(154, y + 2.4, num, 2.4, 'TEXT', al=TA.MIDDLE_CENTER)
        T(235, y + 2.2, brk_txt, 2.4, 'TEXT', al=TA.MIDDLE_CENTER)
        if cab_txt:
            T(372, y + 2.2, cab_txt, 2.4, 'TEXT', al=TA.MIDDLE_CENTER)
        if motor:
            L((170, y), (298, y)); RC(298, y - 2.5, 13, 5)
            T(304.5, y, 'DOL', 2.2, 'TEXT', al=TA.MIDDLE_CENTER)
            L((311, y), (316, y)); RC(316, y - 2.5, 13, 5)
            L((316, y + 0.4), (329, y + 0.4), 'SYMBOL')
            T(322.5, y + 1.4, 'MOA', 2.0, 'TEXT', al=TA.MIDDLE_CENTER)
            CI(319.5, y - 1.2, 1.0); CI(325.5, y - 1.2, 1.0)
            L((329, y), (XEND, y))
        else:
            L((170, y), (XEND, y))

    for i, d in enumerate(rows):
        branch(i, d['no'], d['breaker'], d['cable'], d['phase'] == 3, d['motor'])
    for j in range(nsp):
        branch(len(rows) + j, len(rows) + j + 1, f"SPARE  MCB 1P, {s['min_mcb_1p']}A")

    # ---- table ----
    xs = [TX]
    for _, w in COLS:
        xs.append(xs[-1] + w)
    TW = xs[-1] - TX
    HT, HM = Y0 + 32, Y0 + 12
    mid = lambda k: (xs[k] + xs[k + 1]) / 2
    PL([(TX, Y0), (TX + TW, Y0), (TX + TW, HT), (TX, HT)], 'TABLE-H', True)
    for k in (1, 4, 5, 8):
        L((xs[k], Y0), (xs[k], HT), 'TABLE-H')
    L((xs[1], HM), (xs[4], HM), 'TABLE-H'); L((xs[5], HM), (xs[8], HM), 'TABLE-H')
    for k in (2, 3, 6, 7):
        L((xs[k], Y0), (xs[k], HM), 'TABLE')
    T(mid(0), (Y0 + HT) / 2, 'FUNCTION', 3.0, 'TABLE', al=TA.MIDDLE_CENTER)
    T((xs[1] + xs[4]) / 2, (HM + HT) / 2, 'EQUIPMENT', 3.0, 'TABLE', al=TA.MIDDLE_CENTER)
    T((xs[5] + xs[8]) / 2, (HM + HT) / 2, 'DEMAND LOAD  (WATT)', 3.0, 'TABLE', al=TA.MIDDLE_CENTER)
    T(mid(8), (Y0 + HT) / 2, 'REMARKS', 3.0, 'TABLE', al=TA.MIDDLE_CENTER)
    T(mid(1), (Y0 + HM) / 2 + 2, 'LOAD', 2.3, 'TABLE', al=TA.MIDDLE_CENTER)
    T(mid(1), (Y0 + HM) / 2 - 2, 'EQUIPMENT', 2.3, 'TABLE', al=TA.MIDDLE_CENTER)
    T(mid(2), (Y0 + HM) / 2, 'kW', 2.6, 'TABLE', al=TA.MIDDLE_CENTER)
    T(mid(3), (Y0 + HM) / 2, 'PHASE', 2.6, 'TABLE', al=TA.MIDDLE_CENTER)
    for k, nm in ((5, 'R'), (6, 'S'), (7, 'T')):
        T(mid(k), (Y0 + HM) / 2, nm, 3.0, 'TABLE', al=TA.MIDDLE_CENTER)

    f = lambda v: f'{v:,.1f}'
    for i in range(NROW):
        yt, ybm = Y0 - i * RH, Y0 - (i + 1) * RH
        PL([(TX, yt), (TX + TW, yt), (TX + TW, ybm), (TX, ybm)], 'TABLE', True)
        for k in range(1, 9):
            L((xs[k], yt), (xs[k], ybm), 'TABLE')
        yc = (yt + ybm) / 2
        if i < len(rows):
            d = rows[i]
            T(TX + 2, yc, f"{d['tag']}   {d['desc']}".strip(), 2.3, 'TABLE', al=TA.MIDDLE_LEFT)
            T(mid(1), yc, f(d['watt']), 2.4, 'TABLE', al=TA.MIDDLE_CENTER)
            T(mid(2), yc, f"{d['watt']/1000:.3f}", 2.4, 'TABLE', al=TA.MIDDLE_CENTER)
            T(mid(3), yc, '3 PH' if d['phase'] == 3 else '1 PH', 2.4, 'TABLE', al=TA.MIDDLE_CENTER)
            for k, nm in ((5, 'R'), (6, 'S'), (7, 'T')):
                v = d['watt'] / 3 if d['phase'] == 3 else (d['watt'] if d['ph'] == nm else None)
                if v is not None:
                    T(mid(k), yc, f(v), 2.4, 'TABLE', al=TA.MIDDLE_CENTER)
            rem = d.get('remark') or ('DOL' if d['motor'] else '')
            if rem:
                T(mid(8), yc, rem, 2.0, 'TABLE', al=TA.MIDDLE_CENTER)
        elif i < len(rows) + nsp:
            T(TX + 2, yc, 'SPARE', 2.3, 'TABLE', al=TA.MIDDLE_LEFT)
        else:
            T(mid(1), yc, f(m['total_w']), 2.6, 'TABLE', al=TA.MIDDLE_CENTER)

    # ---- totals ----
    yy = Y0 - NROW * RH
    blocks = [('SUB TOTAL', [f(m['phase_w']['R']), f(m['phase_w']['S']), f(m['phase_w']['T'])]),
              ('TOTAL WATT', [f(m['total_w'])]),
              ('TOTAL  VA', [f(m['va'])]),
              ('CONNECTED AMPERE', [f"{m['amp']:.1f}"])]
    for lab, vals in blocks:
        yt, ybm = yy, yy - RH
        T(xs[5] - 3, (yt + ybm) / 2, lab, 3.0, 'TABLE', al=TA.MIDDLE_RIGHT)
        PL([(xs[5], yt), (xs[8], yt), (xs[8], ybm), (xs[5], ybm)], 'TABLE-H', True)
        if len(vals) == 3:
            for k in (6, 7):
                L((xs[k], yt), (xs[k], ybm), 'TABLE')
            for k, v in zip((5, 6, 7), vals):
                T(mid(k), (yt + ybm) / 2, v, 2.6, 'TABLE', al=TA.MIDDLE_CENTER)
        else:
            T((xs[5] + xs[8]) / 2, (yt + ybm) / 2, vals[0], 2.6, 'TABLE', al=TA.MIDDLE_CENTER)
        yy -= RH

    # ---- notes ----
    alt = [o for o in m['cables'] if o['ok'] and o['runs'] == 2]
    ny = max(120.0, Y0 - (NROW + 4) * RH - 15)
    T(30, ny, 'NOTE :', 3.0, 'TITLE')
    notes = cfg.get('notes') or [
        f"BEBAN 1 FASA DISAMBUNG KE SATU FASA (R / S / T), SUDAH DI-REBALANCE. IMBALANCE ANTAR FASA = {m['imbalance']*100:.2f} %.",
        "BEBAN 3 FASA DIBAGI RATA KE R, S DAN T.",
        f"INCOMING : {inc_txt}, DI ATAS CABLE TRAY, L = +/- {s['cable_length_m']:g} m, AMBIENT {s['ambient_c']:g} C (Ca {s['ca']}).",
        (f"ALTERNATIF KABEL INCOMING : {alt[0]['desc']}." if alt else
         "ALTERNATIF KABEL INCOMING : LIHAT SHEET CABLE SIZING PADA FILE EXCEL."),
        "KONDUKTOR PROTEKSI (PE) MENGIKUTI IEC 60364-5-54 :  S > 35 mm2  ->  PE = S / 2.",
        "SETIAP MOTOR 3 FASA DILENGKAPI DOL STARTER + OVERLOAD RELAY DISETEL SESUAI FLA NAMEPLATE.",
        "MOTOR BESAR YANG JUMLAHNYA BANYAK HARUS START BERTAHAP (SEQUENTIAL) ATAU MEMAKAI SOFT STARTER / VSD.",
        "KAPASITAS & DATA LISTRIK FINAL WAJIB DIKONFIRMASI KONTRAKTOR TERHADAP SELEKSI PERALATAN SEBENARNYA.",
    ]
    for k, n in enumerate(notes):
        T(34, ny - 7 - k * 5.2, f"{k+1}.  {n}", 2.4, 'NOTE')

    # ---- title block ----
    bx, by, bw, bh = W - 15 - 290, 20, 290, 86
    PL([(bx, by), (bx + bw, by), (bx + bw, by + bh), (bx, by + bh)], 'BORDER', True)
    for y2 in (by + 22, by + 40, by + 62):
        L((bx, y2), (bx + bw, y2), 'BORDER')
    T(bx + 5, by + bh - 12, p.get('project', ''), 4.2, 'TITLE')
    T(bx + 5, by + bh - 19, p.get('site', ''), 2.6, 'TITLE')
    T(bx + 5, by + 53, f"PANEL SCHEDULE  -  {p.get('name','PANEL')}", 3.4, 'TITLE')
    T(bx + 5, by + 45, 'SINGLE LINE DIAGRAM & LOAD SCHEDULE', 2.6, 'TITLE')
    T(bx + 5, by + 32, 'STANDAR : IEC 60364-4-43 / -5-52 / -5-54, IEC 60947-2', 2.6, 'TITLE')
    T(bx + 5, by + 26, f"INCOMING : MCCB 3P {m['incoming']} A     |     "
                       f"CONNECTED : {m['amp']:.1f} A", 2.6, 'TITLE')
    T(bx + 5, by + 13, 'SCALE : NTS', 2.6, 'TITLE'); T(bx + 75, by + 13, 'UNIT : mm', 2.6, 'TITLE')
    T(bx + 140, by + 13, f"REV : {p.get('rev','0')}", 2.6, 'TITLE')
    T(bx + 195, by + 13, f"DWG : {p.get('drawing_no','SLD-01')}", 2.6, 'TITLE')
    T(bx + 5, by + 5, f"DATE : {p.get('date','')}", 2.6, 'TITLE')

    os.makedirs(outdir, exist_ok=True)
    base = os.path.join(outdir, f"PANEL_SCHEDULE_{safe_name(p.get('name','PANEL'))}")
    doc.saveas(base + '.dxf')
    print(f"OK  {base}.dxf   sheet {W:.0f} x {H:.0f} mm, {NROW} table rows")

    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from ezdxf.addons.drawing import RenderContext, Frontend
        from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
        from ezdxf.addons.drawing.config import Configuration, ColorPolicy
        fig = plt.figure(); ax = fig.add_axes([0, 0, 1, 1])
        ax.set_facecolor('white'); ax.set_axis_off()
        Frontend(RenderContext(doc), MatplotlibBackend(ax),
                 config=Configuration(color_policy=ColorPolicy.BLACK)).draw_layout(msp, finalize=True)
        fig.set_size_inches(W / 25.4, H / 25.4)
        fig.savefig(base + '.pdf', facecolor='white')
        print(f"OK  {base}.pdf  (preview)")
    except Exception as e:
        print(f"    (preview PDF dilewati: {e})")
    return base


if __name__ == '__main__':
    cfg = load_config(sys.argv[1])
    make(cfg, sys.argv[2] if len(sys.argv) > 2 else '.')
