import { ChangeResourceRecordSetsCommand, Route53Client } from "@aws-sdk/client-route-53"
import { getIdentity } from "@/util/aws/getIdentity"
import { getPanfactumConfig } from "@/util/config/getPanfactumConfig"
import { CLIError } from "@/util/error/error"
import { execute } from "@/util/subprocess/execute"
import type { IEnvironmentMeta } from "@/util/config/getEnvironments"
import type { PanfactumContext } from "@/util/context/context"
import type { ListrTask } from "listr2"

/**
 * Interface for testDNSResolutionTask function input
 */
interface ITestDNSResolutionTaskInput {
  /** Panfactum context for logging and configuration */
  context: PanfactumContext;
  /** Zone configurations mapped by domain name */
  zones: {
    [domain: string]: {
      /** Environment metadata for the zone */
      env: IEnvironmentMeta;
      /** Optional zone ID for the DNS zone */
      zoneId?: string;
      /** Whether to verify DNSSEC for this zone */
      verifyDNSSEC?: boolean;
    }
  }
}

export async function testDNSResolutionTask<T extends {}>(inputs: ITestDNSResolutionTaskInput): Promise<ListrTask<T>> {
    const { context, zones } = inputs
    return {
        title: "Test DNS resolution",
        task: async (_, parentTask) => {
            const subtasks = parentTask.newListr([], { concurrent: false })
            interface IConnectTask { nameServers?: string[] }
            for (const [domain, config] of Object.entries(zones)) {
                subtasks.add({
                    title: context.logger.applyColors(
                        `Test DNS resolution ${domain}`,
                        {
                            lowlights: [domain]
                        },
                    ),
                    task: async (_, parentTask) => {

                        // TODO: We should be able to easily find this
                        // given the env
                        if (!config.zoneId) {
                            parentTask.skip(context.logger.applyColors(`No Zone ID provided for ${domain}`))
                            return
                        }

                        const subsubtasks = parentTask.newListr<IConnectTask>([])

                        // Generate two random 8 character strings for testing
                        const randomString1 = Math.random().toString(36).substring(2, 10);
                        const randomString2 = Math.random().toString(36).substring(2, 10);
                        const testDomain = `${randomString1}.${domain}`

                        const { aws_profile: profile } = await getPanfactumConfig({ context, directory: config.env.path });
                        if (!profile) {
                            throw new CLIError(`Was not able to find AWS profile for '${config.env.name}' environment`);
                        }

                        try {
                            await getIdentity({ context, profile });
                        } catch (error) {
                            throw new CLIError(`Was not able to authenticate with AWS profile '${profile}'`, error);
                        }

                        const deleteRecord = async () => {
                            // Create a TXT record in the zone for testing DNS resolution
                            const route53 = new Route53Client({
                                profile
                            });

                            // Delete the test TXT record if it exists
                            try {
                                await route53.send(new ChangeResourceRecordSetsCommand({
                                    HostedZoneId: config.zoneId,
                                    ChangeBatch: {
                                        Changes: [
                                            {
                                                Action: "DELETE",
                                                ResourceRecordSet: {
                                                    Name: `${randomString1}.${domain}`,
                                                    Type: "TXT",
                                                    TTL: 300,
                                                    ResourceRecords: [
                                                        {
                                                            Value: `"${randomString2}"`
                                                        }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }));
                            } catch {
                                // Ignore errors (if it doesn't exist)
                            }
                        }


                        /////////////////////////////////////////////
                        // Add the test record
                        /////////////////////////////////////////////

                        subsubtasks.add({
                            title: context.logger.applyColors(`Create test TXT record ${randomString1}=${randomString2}`, {
                                lowlights: [`${randomString1}=${randomString2}`]
                            }),
                            task: async () => {
                                const zoneId = config.zoneId

                                if (!zoneId) {
                                    throw new CLIError(`No zoneId found for ${domain}`)
                                }

                                // Create a TXT record in the zone for testing DNS resolution
                                const route53 = new Route53Client({
                                    profile
                                });

                                // Create the test TXT record
                                await route53.send(new ChangeResourceRecordSetsCommand({
                                    HostedZoneId: zoneId,
                                    ChangeBatch: {
                                        Changes: [
                                            {
                                                Action: "CREATE",
                                                ResourceRecordSet: {
                                                    Name: `${randomString1}.${domain}`,
                                                    Type: "TXT",
                                                    TTL: 300,
                                                    ResourceRecords: [
                                                        {
                                                            Value: `"${randomString2}"`
                                                        }
                                                    ]
                                                }
                                            }
                                        ]
                                    }
                                }));
                            }
                        })


                        /////////////////////////////////////////////
                        // Check to see if resolves
                        /////////////////////////////////////////////
                        subsubtasks.add({
                            title: `Verify TXT record resolves`,
                            rollback: async () => {
                                await deleteRecord();
                            },
                            task: async (_, task) => {
                                task.output = context.logger.applyColors(
                                    `This can sometimes take up to an hour.\n` +
                                    `To speed up this test, purge cloudflare's DNS cache using\nhttps://one.one.one.one/purge-cache/\n\n` +
                                    `Use the domain name ${domain} and record type NS.`,
                                    { style: "warning", highlights: [" NS"] }
                                )

                                let retries = 0;
                                const maxRetries = 500;
                                let records: string[];
                                while (true) {
                                    try {
                                        // Use dig command to resolve the TXT record
                                        // Note for some reason the internal bun DNS
                                        // function don't refresh the DNS results
                                        // data but calling out to an external process fixes
                                        // that issue
                                        const result = await execute({
                                            command: ["dig", "+short", "TXT", testDomain, "@1.1.1.1"],
                                            context,
                                            workingDirectory: process.cwd(),
                                            errorMessage: "Failed to execute dig command"
                                        });

                                        // Check if we got a response
                                        if (!result.stdout.trim()) {
                                            throw new CLIError(`No response from dig`)
                                        }

                                        // Parse the response
                                        // dig +short returns TXT records in the format: "value"
                                        records = result.stdout.split('\n')
                                            .filter(line => line.trim() !== '')
                                            .map(line => line.trim().replace(/^"(.*)"$/, '$1'));

                                        break;
                                    } catch {
                                        if (retries < maxRetries) {
                                            const attemptStr = `Attempt ${retries + 1}/${maxRetries}`
                                            task.title = context.logger.applyColors(`Verify TXT record resolves ${attemptStr}`, {
                                                lowlights: [attemptStr]
                                            })
                                            retries++;
                                            await new Promise(resolve => globalThis.setTimeout(resolve, 10000));
                                        } else {
                                            throw new CLIError(`Failed to resolve TXT record after ${maxRetries} attempts`)
                                        }
                                    }
                                }

                                if (records.length === 0) {
                                    throw new CLIError(`${testDomain} resolved but did not return any TXT records`)
                                } else if (records[0] !== randomString2) {
                                    throw new CLIError(`${testDomain} resolved but did not have expected TXT record ${randomString2}`)
                                }

                                task.title = context.logger.applyColors(`Verify TXT record resolves Success`, {
                                    lowlights: ["Success"]
                                })
                            }
                        })

                        /////////////////////////////////////////////
                        // Check to see if DNSSEC works
                        /////////////////////////////////////////////
                        if (config.verifyDNSSEC) {
                            subsubtasks.add({
                                title: `Verify DNSSEC`,
                                rollback: async () => {
                                    await deleteRecord();
                                },
                                task: async (_, task) => {
                                    let retries = 0;
                                    const maxRetries = 25;
                                    while (true) {
                                        try {
                                            // Use dig command to resolve the TXT record
                                            // Note for some reason the internal bun DNS
                                            // function don't refresh the DNS results
                                            // data but calling out to an external process fixes
                                            // that issue
                                            const result = await execute({
                                                command: ["delv", "@1.1.1.1", "txt", testDomain],
                                                context,
                                                workingDirectory: process.cwd(),
                                                errorMessage: "Failed to execute delv command"
                                            });

                                            // Check if we got a response
                                            const output = result.stdout.trim()
                                            if (!output) {
                                                throw new CLIError(`No response from delv`)
                                            } else if (!output.includes("; fully validated")) {
                                                throw new CLIError(`DNSSEC not fully validated yet`)
                                            }
                                            break;
                                        } catch {
                                            if (retries < maxRetries) {
                                                const attemptStr = `Attempt ${retries + 1}/${maxRetries}`
                                                task.title = context.logger.applyColors(`Verify DNSSEC ${attemptStr}`, {
                                                    lowlights: [attemptStr]
                                                })
                                                retries++;
                                                await new Promise(resolve => globalThis.setTimeout(resolve, 10000));
                                            } else {
                                                throw new CLIError(`Failed to resolve DNSSEC record after ${maxRetries} attempts`)
                                            }
                                        }
                                    }

                                    task.title = context.logger.applyColors(`Verify DNSSEC Success`, {
                                        lowlights: ["Success"]
                                    })
                                }
                            })
                        }


                        /////////////////////////////////////////////
                        // Remove the TXT record
                        /////////////////////////////////////////////

                        subsubtasks.add({
                            title: "Cleanup records",
                            task: async () => {
                                await deleteRecord()
                            }
                        })

                        return subsubtasks;
                    }
                })
            }
            return subtasks
        }
    }
}