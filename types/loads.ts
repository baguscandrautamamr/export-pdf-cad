export interface PanelInfo {
  name: string;
  ip?: string;
  location?: string;
  reference?: string;
  project?: string;
  site?: string;
  source?: string;
  drawing_no?: string;
  rev?: string;
  date?: string;
  group?: string;
}

export interface SystemConfig {
  voltage_ll?: number;
  voltage_ln?: number;
  pf?: number;
  ambient_c?: number;
  cable_length_m?: number;
  spare_percent?: number;
  spare_circuits?: number;
  vd_limit?: number;
  min_mcb_1p?: number;
}

export interface Load {
  tag: string;
  desc: string;
  watt: number;
  phase: 1 | 3;
  qty?: number;
  motor?: boolean;
  remark?: string;
}

export interface LoadsFile {
  panel: PanelInfo;
  system?: SystemConfig;
  loads: Load[];
}

export interface ExtractResponse {
  loads: LoadsFile;
  warnings: string[];
}

export interface GeneratedFile {
  name: string;
  mime: string;
  base64: string;
}

export interface GenerateResponse {
  summary: string[];
  files: GeneratedFile[];
}
