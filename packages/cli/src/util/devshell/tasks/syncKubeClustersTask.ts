import { join, dirname } from "node:path";
import { Glob } from "bun";
import { z } from "zod";
import { getPanfactumConfig } from "@/util/config/getPanfactumConfig";
import { CLIError } from "@/util/error/error";
import { createDirectory } from "@/util/fs/createDirectory";
import { getLastPathSegments } from "@/util/fs/getLastPathSegments";
import { MODULES } from "@/util/terragrunt/constants";
import { terragruntOutput } from "@/util/terragrunt/terragruntOutput";
import { writeYAMLFile } from "@/util/yaml/writeYAMLFile";
import { CLUSTERS_FILE_SCHEMA } from "../../kube/schemas";
import { updateKubeConfig } from "../../kube/updateKubeConfig";
import type { PanfactumContext } from "@/util/context/context";
import type { ListrTask } from "listr2";

interface ITaskContext {
    clusterInfo: {
        caData: string;
        url: string;
        name: string;
        regionDir: string;
        envDir: string;
    }[];
}

export const EKS_MODULE_OUTPUT_SCHEMA = z.object({
    cluster_ca_data: z.object({
        sensitive: z.boolean(),
        type: z.string(),
        value: z.string().base64(),
    }),
    cluster_url: z.object({ value: z.string() }),
    cluster_name: z.object({ value: z.string() }),
    cluster_region: z.object({ value: z.string() }),
});

/**
 * Interface for buildSyncKubeClustersTask function inputs
 */
interface IBuildSyncKubeClustersTaskInput {
    /** Panfactum context for operations */
    context: PanfactumContext;
}

// TODO: Verify access to each cluster...
export async function buildSyncKubeClustersTask<T extends {}>(input: IBuildSyncKubeClustersTaskInput): Promise<ListrTask<T>> {
    const { context } = input;

    return {
        title: "Sync Kubernetes clusters credentials",
        task: async (_, parentTask) => {
            const { kube_dir: kubeDir, environments_dir: environmentsDir } =
                context.devshellConfig;
            const clustersYAMLPath = join(kubeDir, "clusters.yaml");
            const kubeConfigPath = join(kubeDir, "config");

            ///////////////////////////////////////////////////////
            // Check if there are any EKS modules; if no, skip
            ///////////////////////////////////////////////////////
            const glob = new Glob(
                join(environmentsDir, "**", MODULES.AWS_EKS, "terragrunt.hcl")
            );
            const eksHCLPaths = Array.from(glob.scanSync(environmentsDir));
            if (eksHCLPaths.length === 0) {
                parentTask.skip(
                    context.logger.applyColors(
                        "Skipped sync Kubernetes Clusters credentials to DevShell No clusters found",
                        {
                            lowlights: ["No clusters found"],
                        }
                    )
                );
                return;
            }

            await createDirectory({ dirPath: kubeDir });
            const subtasks = parentTask.newListr<ITaskContext>([], {
                ctx: {
                    clusterInfo: [],
                },
            });

            ///////////////////////////////////////////////////////
            // Add subtasks for fetching the module outputs
            ///////////////////////////////////////////////////////
            subtasks.add({
                title: "Retrieve info for clusters",
                task: (_, subtask) => {
                    const subsubtasks = subtask.newListr([], { concurrent: true })
                    eksHCLPaths.forEach((eksHCLPath) => {
                        const moduleDirectory = dirname(eksHCLPath);
                        const clusterId = getLastPathSegments({ path: moduleDirectory, lastSegments: 3 });
                        subsubtasks.add({
                            title: context.logger.applyColors(`Retrieve cluster info ${clusterId}`, {
                                lowlights: [clusterId],
                            }),
                            task: async (ctx, task) => {
                                const { environment_dir: envDir, region_dir: regionDir } =
                                    await getPanfactumConfig({ context, directory: moduleDirectory });

                                if (!envDir) {
                                    throw new CLIError(
                                        "Module is not in a valid environment directory."
                                    );
                                } else if (!regionDir) {
                                    throw new CLIError("Module is not in a valid region directory.");
                                }

                                const moduleOutput = await terragruntOutput({
                                    context,
                                    environment: envDir,
                                    region: regionDir,
                                    module: MODULES.AWS_EKS,
                                    validationSchema: EKS_MODULE_OUTPUT_SCHEMA,
                                });
                                const name = moduleOutput.cluster_name.value;
                                ctx.clusterInfo.push({
                                    caData: globalThis.atob(moduleOutput.cluster_ca_data.value),
                                    name,
                                    url: moduleOutput.cluster_url.value,
                                    regionDir,
                                    envDir,
                                });
                                context.logger.addIdentifier(name)
                                task.title = context.logger.applyColors(
                                    `Retrieved ${name} cluster info ${clusterId}`,
                                    {
                                        lowlights: [clusterId]
                                    }
                                );
                            },
                        });
                    });
                    return subsubtasks
                }
            })

            ///////////////////////////////////////////////////////
            // Write the configuration files
            ///////////////////////////////////////////////////////
            subtasks.add({
                title: context.logger.applyColors(
                    `Syncing DevShell configuration ${clustersYAMLPath}`,
                    { lowlights: [clustersYAMLPath] }
                ),
                task: async (ctx) => {
                    const clusterInfo: z.infer<typeof CLUSTERS_FILE_SCHEMA> = {};
                    for (const {
                        name,
                        regionDir,
                        envDir,
                        url,
                        caData,
                    } of ctx.clusterInfo) {
                        clusterInfo[name] = {
                            envDir,
                            url,
                            regionDir,
                            caData: globalThis.btoa(caData),
                        };
                    }
                    await writeYAMLFile({
                        context,
                        values: clusterInfo,
                        overwrite: true,
                        filePath: clustersYAMLPath,
                    });
                },
            });

            ///////////////////////////////////////////////////////
            // Update kubeconfig
            ///////////////////////////////////////////////////////
            subtasks.add({
                title: context.logger.applyColors(`Updating Kubeconfig ${kubeConfigPath}`, {
                    lowlights: [kubeConfigPath],
                }),
                task: async () => {
                    await updateKubeConfig({ context });
                },
            });

            return subtasks;
        },
    };
}
