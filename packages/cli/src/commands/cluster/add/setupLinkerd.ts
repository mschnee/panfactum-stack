import { join } from "node:path";
import { z } from "zod";
import kubeLinkerdTerragruntHcl from "@/templates/kube_linkerd_terragrunt.hcl" with { type: "file" };
import { getIdentity } from "@/util/aws/getIdentity";
import { CLIError } from "@/util/error/error";
import { sopsDecrypt } from "@/util/sops/sopsDecrypt";
import { execute } from "@/util/subprocess/execute";
import { killBackgroundProcess } from "@/util/subprocess/killBackgroundProcess";
import { startVaultProxy } from "@/util/subprocess/vaultProxy";
import { MODULES } from "@/util/terragrunt/constants";
import { buildDeployModuleTask } from "@/util/terragrunt/tasks/deployModuleTask";
import { readYAMLFile } from "@/util/yaml/readYAMLFile";
import type { InstallClusterStepOptions } from "./common";
import type { PanfactumTaskWrapper } from "@/util/listr/types";

export async function setupLinkerd(
  options: InstallClusterStepOptions,
  mainTask: PanfactumTaskWrapper
) {
  const { awsProfile, context, environment, clusterPath, region } = options;


  // FIX: @seth - The vault token should be found using getPanfactumConfig
  const vaultSecrets = await sopsDecrypt({
    filePath: join(clusterPath, MODULES.KUBE_VAULT, "secrets.yaml"),
    context,
    validationSchema: z.object({
      root_token: z.string(),
    }),
  });

  if (!vaultSecrets) {
    throw new CLIError('Was not able to find vault token.')
  }
  const { root_token: vaultRootToken } = vaultSecrets;

  interface Context {
    kubeContext?: string;
    vaultProxyPid?: number;
    vaultProxyPort?: number;
  }

  const tasks = mainTask.newListr<Context>([
    {
      title: "Verify access",
      task: async (ctx) => {
        await getIdentity({ context, profile: awsProfile });
        const regionConfig = await readYAMLFile({ filePath: join(clusterPath, "region.yaml"), context, validationSchema: z.object({ kube_config_context: z.string() }) });
        ctx.kubeContext = regionConfig?.kube_config_context;
        if (!ctx.kubeContext) {
          throw new CLIError("Kube context not found");
        }
      },
    },
    {
      title: "Start Vault Proxy",
      task: async (ctx) => {
        const { pid, port } = await startVaultProxy({
          env: {
            ...process.env,
            VAULT_TOKEN: vaultRootToken,
          },
          kubeContext: ctx.kubeContext!,
          modulePath: join(clusterPath, MODULES.KUBE_LINKERD),
        });
        ctx.vaultProxyPid = pid;
        ctx.vaultProxyPort = port;
      },
    },
    {
      task: async (ctx, task) => {
        return task.newListr<Context>(
          [
            await buildDeployModuleTask({
              taskTitle: "Deploy Linkerd Service Mesh",
              context,
              env: {
                ...process.env,
                VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
                VAULT_TOKEN: vaultRootToken,
              },
              environment,
              region,
              skipIfAlreadyApplied: true,
              module: MODULES.KUBE_LINKERD,
              initModule: true,
              hclIfMissing: await Bun.file(kubeLinkerdTerragruntHcl).text(),
            }),
          ],
          { ctx }
        );
      },
    },
    // TODO: @seth - How to resume from here if this fails?
    {
      title: "Run Linkerd Control Plane Checks",
      task: async (ctx, task) => {
        const regionConfig = await readYAMLFile({ filePath: join(clusterPath, "region.yaml"), context, validationSchema: z.object({ kube_config_context: z.string() }) });
        const kubeContext = regionConfig?.kube_config_context;
        if (!kubeContext) {
          throw new CLIError("Kube context not found");
        }
        await execute({
          command: ["linkerd", "check", "--cni-namespace=linkerd", "--context", kubeContext],
          context,
          workingDirectory: join(clusterPath, MODULES.KUBE_LINKERD),
          errorMessage: "Linkerd control plane checks failed",
          isSuccess: ({ exitCode, stdout }) =>
            exitCode === 0 ||
            (stdout as string).includes("Status check results are √"),
          env: {
            ...process.env,
            VAULT_ADDR: `http://127.0.0.1:${ctx.vaultProxyPort}`,
            VAULT_TOKEN: vaultRootToken,
          },
          onStdOutNewline: (line) => {
            task.output = context.logger.applyColors(line, { style: "subtle", highlighterDisabled: true });
          },
          onStdErrNewline: (line) => {
            task.output = context.logger.applyColors(line, { style: "subtle", highlighterDisabled: true });
          },
        });
      },
      rendererOptions: {
        outputBar: 5,
      },
    },
    {
      title: "Stop Vault Proxy",
      task: async (ctx) => {
        if (ctx.vaultProxyPid) {
          killBackgroundProcess({ pid: ctx.vaultProxyPid, context });
        }
      },
    },
  ]);

  return tasks;
}
