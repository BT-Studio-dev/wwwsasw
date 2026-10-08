export type PterodactylStatus = {
  configured: boolean;
  panelUrl: string | null;
  message: string;
};

export type PterodactylServer = {
  id: string;
  name: string;
  identifier: string;
  uuid: string;
  status: string | null;
  suspended: boolean;
  nodeId: string;
  allocationId: string;
  nestId: string;
  eggId: string;
  limits: { memory: number; disk: number; cpu: number; swap: number };
  createdAt: string | null;
};

export type PterodactylAllocation = {
  id: string;
  ip: string;
  alias: string | null;
  port: number;
  notes: string | null;
  assigned: boolean;
};

export type PterodactylNode = {
  id: string;
  uuid: string;
  name: string;
  description: string;
  fqdn: string;
  scheme: string;
  maintenanceMode: boolean;
  memory: number;
  disk: number;
  daemonListen: number;
  daemonSftp: number;
  allocations: PterodactylAllocation[];
};

export type PterodactylEgg = {
  id: string;
  uuid: string;
  name: string;
  author: string;
  description: string;
  dockerImage: string;
};

export type PterodactylNest = {
  id: string;
  name: string;
  description: string;
  eggs: PterodactylEgg[];
};

export type PterodactylResources = {
  servers: PterodactylServer[];
  nodes: PterodactylNode[];
  nests: PterodactylNest[];
};

export type PterodactylPanelData = PterodactylResources & { status: PterodactylStatus };

export type AllocationCreateInput = {
  ip: string;
  alias?: string;
  ports: string[];
};
