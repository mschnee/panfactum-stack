import path from "path";
import { Glob } from "bun";
import { z } from "zod";
import { getLastPathSegments } from "../../../util/getLastPathSegments";
import { terragruntOutput } from "../../../util/terragrunt/terragruntOutput";
import type { PanfactumContext } from "../../../context/context";

export async function buildSSHConfig({
  awsProfile,
  context,
}: {
  awsProfile: string;
  context: PanfactumContext;
}) {
  const { ssh_dir, environments_dir } = context.repoVariables;

  const knownHostsFile = ssh_dir + "/known_hosts";
  const connectionInfoFile = ssh_dir + "/connection_info";

  // This is a rebuild, so we delete any existing config files
  await Promise.all(
    [knownHostsFile, connectionInfoFile].map(async (filePath) => {
      // Took this out to build the CLI to test
      // if (await safeFileExists(filePath)) {
      //   const file = Bun.file(filePath);
      //   await file.delete();
      // }
    })
  );

  const glob = new Glob(`${environments_dir}/**/kube_bastion/terragrunt.hcl`);
  const bastionHCLs = Array.from(glob.scanSync(environments_dir));
  if (bastionHCLs.length > 0) {
    context.stderr.write(`Connecting DevShell to deployed bastions:\n\n`);
    const knownHostsContents: string[] = [];
    const connectionInfoContents: string[] = [];
    await Promise.all(
      Array.from(glob.scanSync(environments_dir)).map(
        async (bastionTerragruntHCL) => {
          const directory = path.dirname(bastionTerragruntHCL);
          context.stderr.write(
            `  Adding bastion at ${getLastPathSegments(directory, 3)}...\n`
          );
          const moduleOutput = await terragruntOutput({
            awsProfile,
            context: {
              ...context,
              // stdout: createNullWriter() // I took this out to build the CLI to test
            },
            modulePath: directory,
            validationSchema: z.object({
              bastion_host_public_key: z.object({
                sensitive: z.boolean(),
                type: z.string(),
                value: z.string(),
              }),
              bastion_domains: z.object({
                sensitive: z.boolean(),
                type: z.array(z.string()),
                value: z.array(z.string()),
              }),
              bastion_port: z.object({
                sensitive: z.boolean(),
                type: z.string(),
                value: z.number(),
              }),
            }),
          });

          const numberOfDomains = moduleOutput.bastion_domains.value.length;
          for (let j = 0; j < numberOfDomains; j++) {
            const domain = moduleOutput.bastion_domains.value[j];
            const publicKey = moduleOutput.bastion_host_public_key.value;
            const port = moduleOutput.bastion_port.value;

            knownHostsContents.push(`[${domain}]:${port} ${publicKey}`);
            // TODO: Fix name
            connectionInfoContents.push(`test ${domain} ${port}`);
          }
        }
      )
    );

    await Promise.all([
      Bun.write(Bun.file(knownHostsFile), knownHostsContents.join("\n")),
      Bun.write(
        Bun.file(connectionInfoFile),
        connectionInfoContents.join("\n")
      ),
    ]);

    context.stderr.write(`\n  Clusters connected!\n`);
  }
}
