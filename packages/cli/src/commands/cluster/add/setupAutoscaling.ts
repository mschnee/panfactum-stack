import { z } from "zod";
import kubeKarpenterNodePoolsTerragruntHcl from "@/templates/kube_karpenter_node_pools_terragrunt.hcl" with { type: "file" };
import kubeKarpenterTerragruntHcl from "@/templates/kube_karpenter_terragrunt.hcl" with { type: "file" };
import kubeMetricsServerTerragruntHcl from "@/templates/kube_metrics_server_terragrunt.hcl" with { type: "file" };
import kubeSchedulerTerragruntHcl from "@/templates/kube_scheduler_terragrunt.hcl" with { type: "file" };
import kubeVpaTerragruntHcl from "@/templates/kube_vpa_terragrunt.hcl" with { type: "file" };
import { getIdentity } from "@/util/aws/getIdentity";
import { upsertConfigValues } from "@/util/config/upsertConfigValues";
import { MODULES } from "@/util/terragrunt/constants";
import {
  buildDeployModuleTask,
  defineInputUpdate,
} from "@/util/terragrunt/tasks/deployModuleTask";
import type { IInstallClusterStepOptions } from "./common";
import type { PanfactumTaskWrapper } from "@/util/listr/types";

export async function setupAutoscaling(
  options: IInstallClusterStepOptions,
  mainTask: PanfactumTaskWrapper
) {
  const { awsProfile, context, environment, region, slaTarget } =
    options;

  interface IContext {
    vaultProxyPid?: number;
    vaultProxyPort?: number;
  }

  const tasks = mainTask.newListr<IContext>([
    {
      title: "Verify access",
      task: async () => {
        await getIdentity({ context, profile: awsProfile });
      },
    },
    // Moved this here due to edge case in current resumability implementation
    await buildDeployModuleTask({
      taskTitle: "Deploy Vault Core Resources with permanent Vault Address",
      context,
      environment,
      region,
      skipIfAlreadyApplied: false,
      module: MODULES.VAULT_CORE_RESOURCES,
      env: {
        ...process.env, //TODO: @seth Use context.env
      },
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Metrics Server",
      context,
      env: {
        ...process.env,
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_METRICS_SERVER,
      hclIfMissing: await Bun.file(
        kubeMetricsServerTerragruntHcl
      ).text(),
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Vertical Pod Autoscaler",
      context,
      env: {
        ...process.env,
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_VPA,
      hclIfMissing: await Bun.file(kubeVpaTerragruntHcl).text(),
    }),
    {
      title: "Enabling Vertical Pod Autoscaler",
      task: async () => {
        await upsertConfigValues({
          context,
          environment,
          region,
          values: {
            extra_inputs: {
              vpa_enabled: true,
            },
          },
        });
      },
    },
    await buildDeployModuleTask({
      taskTitle: "Deploy Karpenter",
      context,
      env: {
        ...process.env, //TODO: @seth Use context.env
      },
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_KARPENTER,
      hclIfMissing: await Bun.file(
        kubeKarpenterTerragruntHcl
      ).text(),
      inputUpdates: {
        wait: defineInputUpdate({
          schema: z.boolean(),
          update: () => false,
        }),
      },
    }),
    {
      title: "Remove Karpenter Bootstrap Variable",
      task: async () => {
        await upsertConfigValues({
          context,
          environment,
          region,
          module: MODULES.KUBE_KARPENTER,
          values: {
            extra_inputs: {
              wait: undefined,
            }
          }
        });
      },
    },
    await buildDeployModuleTask({
      taskTitle: "Deploy Karpenter Node Pools",
      context,
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_KARPENTER_NODE_POOLS,
      hclIfMissing: await Bun.file(
        kubeKarpenterNodePoolsTerragruntHcl
      ).text(),
      // TODO: @jack - This should be pulled from the aws_eks module
      // to keep things in sync
      inputUpdates: {
        node_subnets: defineInputUpdate({
          schema: z.array(z.string()),
          update: () =>
            slaTarget === 1
              ? ["PRIVATE_A"]
              : ["PRIVATE_A", "PRIVATE_B", "PRIVATE_C"],
        }),
      },
    }),
    await buildDeployModuleTask({
      taskTitle: "Deploy Scheduler",
      context,
      environment,
      region,
      skipIfAlreadyApplied: true,
      module: MODULES.KUBE_SCHEDULER,
      hclIfMissing: await Bun.file(
        kubeSchedulerTerragruntHcl
      ).text(),
    }),
    {
      title: "Enable Bin Packing Scheduler",
      task: async () => {
        await upsertConfigValues({
          context,
          environment,
          region,
          values: {
            extra_inputs: {
              panfactum_scheduler_enabled: true,
            },
          },
        });
      },
    }
  ])

  return tasks;
}
