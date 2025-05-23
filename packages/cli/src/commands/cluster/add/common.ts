import type { PanfactumContext } from "@/util/context/context";

export interface InstallClusterStepOptions {
  awsProfile: string;
  clusterPath: string;
  environmentPath: string;
  environment: string;
  kubeConfigContext?: string;
  domains: Record<string, { zone_id: string; record_manager_role_arn: string; }>;
  region: string;
  context: PanfactumContext;
  slaTarget: 1 | 2 | 3;
}
