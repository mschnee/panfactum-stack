// This file defines the domain add command for connecting domains to Panfactum
// It handles domain registration, DNS zone creation, and environment linking

import { Command, Option } from "clipanion";
import pc from "picocolors";
import { PanfactumCommand } from "@/util/command/panfactumCommand";
import { getEnvironments, type IEnvironmentMeta } from "@/util/config/getEnvironments";
import { DOMAIN } from "@/util/config/schemas";
import { getDomains } from "@/util/domains/getDomains";
import { isRegistered } from "@/util/domains/isRegistered";
import { CLIError, PanfactumZodError } from "@/util/error/error";
import { MANAGEMENT_ENVIRONMENT } from "@/util/terragrunt/constants";
import { createDescendentZones } from "./createDescendentZones";
import { createEnvironmentSubzones } from "./createEnvironmentSubzones";
import { getEnvironmentForZone } from "./getEnvironmentForZone";
import { manualZoneSetup } from "./manualZoneSetup";
import { registerDomain } from "./registerDomain";

/**
 * CLI command for adding domains to Panfactum environments
 * 
 * @remarks
 * This command manages the complex process of connecting domains to the
 * Panfactum infrastructure. It handles multiple scenarios including:
 * 
 * 1. **Domain Registration**: Purchase new domains through AWS Route53
 * 2. **Existing Domain Import**: Connect already-owned domains
 * 3. **Subdomain Creation**: Automatically create environment-specific subdomains
 * 4. **DNS Zone Setup**: Deploy and configure Route53 hosted zones
 * 5. **Cross-Environment Linking**: Connect subdomains across environments
 * 
 * Domain architecture in Panfactum:
 * - Domains belong to specific environments for security isolation
 * - Workloads can only use domains from their environment
 * - Subdomains can be automatically created (e.g., dev.example.com)
 * - DNS and TLS certificates are automatically managed
 * 
 * The command intelligently detects:
 * - Whether a domain is already registered
 * - If it's an apex domain or subdomain
 * - Existing Panfactum configurations
 * - Parent domain relationships
 * 
 * Security considerations:
 * - Environment isolation prevents cross-environment domain access
 * - DNS zones are deployed in the selected environment
 * - Proper domain ownership verification
 * 
 * @example
 * ```bash
 * # Interactive domain addition
 * pf domain add
 * 
 * # Add specific domain to production
 * pf domain add --domain example.com --environment production
 * 
 * # Add subdomain to development
 * pf domain add --domain dev.example.com --environment development
 * 
 * # Force domain as registered (skip detection)
 * pf domain add --domain example.com --force-is-registered
 * ```
 * 
 * @see {@link getDomains} - For listing existing domain configurations
 * @see {@link isRegistered} - For checking domain registration status
 * @see {@link registerDomain} - For purchasing domains through AWS
 */
export class DomainAddCommand extends PanfactumCommand {
    static override paths = [["domain", "add"]];

    static override usage = Command.Usage({
        description: "Add a domain to the Panfactum stack",
        category: 'Domain',
        details: `
        Connects a domain to the Panfactum framework installation so that clusters and workloads can use it.

        In Panfactum, ${pc.italic("domains")} are added to ${pc.italic("environments")}. Any workload in an environment can
        host resources on the environment's domains (or subdomains of those domains). All necessary DNS and TLS infrastructure
        will be automatically handled by the Panfactum framework.

        This CLI can handle the following scenarios (automatically detected):
        
          * Purchasing a new domain via AWS

          * Adding an already-purchased domain from another registrar

          * Adding a subdomain of a domain that has already been added

        Tip #1

        Workloads in one environment CANNOT directly access domains in other environments (for security).
        For example, workloads in your ${pc.magentaBright("development")} environment would not be able to alter records attached to domains
        added to your ${pc.blue("production")} environment.

        However, this utility CAN create subdomains for existing domains and automatically link those across environments.
        For example, if you have the ${pc.blue("mycompany.com")} domain added to your ${pc.blue("production")} environment,
        you can run 
        
          ${pc.bold("pf domain add --domain dev.panfactum.com --environment development")}
        
        to allow workloads in ${pc.magentaBright("development")} to use ${pc.magentaBright("api.dev.mycompany.com")}
        (but not ${pc.blue("api.mycompany.com")}).

        Tip #2

        Migrating domains from one environment to another will likely involve some amount of downtime as DNS records are heavily
        cached all over the globe. As a result, we recommend putting extra care into ensuring
        your customer-facing domains are added to the environment you plan on using for customer-facing workloads.
        `,

        examples: [
            ["Use the interactive prompts", "$0 domain add"],
            ["Preselect the domain and environment", "$0 domain add --domain mycompany.com --environment production"],
        ]

    });


    /** Target environment for the domain */
    environment: string | undefined = Option.String("--environment,-e", {
        description: "The environment to which the domain will be added",
        arity: 1
    });

    /** Domain name to add (e.g., example.com or sub.example.com) */
    domain: string | undefined = Option.String("--domain,-d", {
        description: "The domain to add to the Panfactum installation",
        arity: 1
    });

    /** Skip domain registration detection */
    forceIsRegistered: boolean | undefined = Option.Boolean("--force-is-registered", {
        description: "Overrides built-in heuristic for determining whether the provided domain is already registered",

    })

    /**
     * Executes the domain addition process
     * 
     * @remarks
     * This method orchestrates a complex workflow that adapts based on:
     * - Domain type (apex vs subdomain)
     * - Registration status
     * - Existing Panfactum configurations
     * - User choices throughout the process
     * 
     * The workflow includes:
     * 1. Validation of environment and domain format
     * 2. Fetching public suffix list for TLD detection
     * 3. Checking existing configurations
     * 4. Domain registration or import
     * 5. DNS zone creation and delegation
     * 6. Environment subdomain setup
     * 
     * @returns Exit code (0 for success, 1 for errors)
     * 
     * @throws {@link CLIError}
     * Throws when environment doesn't exist or domain is invalid
     * 
     * @throws {@link PanfactumZodError}
     * Throws when domain format validation fails
     */
    async execute() {
        const { context, environment, domain, forceIsRegistered = false } = this

        let newDomain = domain;

        /////////////////////////////////////////////////////////////////////////
        // Validations
        /////////////////////////////////////////////////////////////////////////
        let environmentMeta: IEnvironmentMeta | undefined;
        const environments = await getEnvironments(context)
        if (environment) {
            const environmentMetaIndex = environments.findIndex(actualEnv => actualEnv.name === environment)
            if (environmentMetaIndex === -1) {
                throw new CLIError(`The environment ${environment} does not exist.`)
            } else if (environment === MANAGEMENT_ENVIRONMENT) {
                throw new CLIError(`Domains cannot be added to the ${MANAGEMENT_ENVIRONMENT} environment.`)
            } else {
                environmentMeta = environments[environmentMetaIndex]!
            }
        } else if (environments.filter(env => env.name !== MANAGEMENT_ENVIRONMENT).length === 0) {
            throw new CLIError(`You must have at least one environment to add a domain: \`pf env add\``)
        }
        environments.forEach(env => context.logger.addIdentifier(` ${env.name} `))

        /////////////////////////////////////////////////////////////////////////
        // Download valid domain suffices
        /////////////////////////////////////////////////////////////////////////

        let domainSuffices: string[];

        try {
            const suffixList = await (await globalThis.fetch("https://publicsuffix.org/list/public_suffix_list.dat")).text();
            domainSuffices = suffixList.split("\n")
                .filter(maybeSuffix => !maybeSuffix.startsWith("//") && !maybeSuffix.startsWith("*") && maybeSuffix !== "")
                .sort((a, b) => b.length - a.length) // longest first
        } catch (e) {
            throw new CLIError("Failed to fetch domain apex suffices", e)
        }

        /////////////////////////////////////////////////////////////////////////
        // Get the domain
        /////////////////////////////////////////////////////////////////////////

        if (!newDomain) {
            newDomain = await context.logger.input({
                explainer: `
                    In Panfactum, ${pc.italic("domains")} are added to ${pc.italic("environments")}. Any workload in an environment can
                    host resources on the environment's domains (or subdomains of those domains).
                `,
                message: "Enter domain:",
                validate: async (val) => {
                    const { error } = DOMAIN.safeParse(val)
                    if (error) {
                        return error.issues[0]?.message ?? "Invalid domain"
                    }
                    if (!domainSuffices.some(suffix => val.endsWith(`.${suffix}`))) {
                        return "TLD not recognized"
                    }
                    return true
                }
            })
        } else {
            const parseResult = DOMAIN.safeParse(newDomain);
            if (!parseResult.success) {
                throw new PanfactumZodError("Invalid domain format", "--domain", parseResult.error);
            }
            newDomain = parseResult.data;
        }
        context.logger.addIdentifier(newDomain)

        /////////////////////////////////////////////////////////////////////////
        // Check if apex
        /////////////////////////////////////////////////////////////////////////
        let isApex = false;
        let tld = ""
        let apexDomain = ""
        for (const suffix of domainSuffices) {
            const suffixTest = `.${suffix}`
            if (newDomain.endsWith(suffixTest)) {
                const domainWithoutSuffix = newDomain.slice(0, -suffixTest.length);
                const domainLabels = domainWithoutSuffix.split('.')
                tld = suffix;
                apexDomain = `${domainLabels[domainLabels.length - 1]}.${tld}`
                if (domainLabels.length === 1 && domainLabels[0] !== "") {
                    isApex = true
                }
                break;
            }
        }

        if (apexDomain) {
            context.logger.addIdentifier(apexDomain)
        }

        /////////////////////////////////////////////////////////////////////////
        // Check if already added
        /////////////////////////////////////////////////////////////////////////
        const domainConfigs = await getDomains({ context })
        const [_, existingDomainConfig] = Object.entries(domainConfigs)
            .find(([domain]) => {
                return domain === newDomain
            }) ?? []


        if (existingDomainConfig) {

            // TODO: Verify if environment is different from the environment where the domain is deployed

            context.logger.info(`You've already added ${newDomain} to ${existingDomainConfig.env.name}.`)

            ////////////////////////////////////////////////////////
            // Environment subzones - Auto
            ////////////////////////////////////////////////////////
            await createEnvironmentSubzones({
                context,
                domain: newDomain,
                existingDomainConfigs: domainConfigs
            })

            return 0
        }

        /////////////////////////////////////////////////////////////////////////
        // Main Logic 
        /////////////////////////////////////////////////////////////////////////

        if (isApex) {

            ////////////////////////////////////////////////////////
            // Check if domain is already registered
            ////////////////////////////////////////////////////////
            if (forceIsRegistered || await isRegistered({ domain: newDomain, context })) {

                ////////////////////////////////////////////////////////
                // Confirm the user is the owner
                ////////////////////////////////////////////////////////
                context.logger.info(`${newDomain} has already been purchased, but it has not been added yet.`)
                const ownsDomain = await context.logger.confirm({
                    message: `Are you the owner of ${newDomain}?`,
                    default: true
                })

                if (!ownsDomain) {
                    context.logger.error(`You cannot add ${newDomain} unless you own it.`)
                    return 1
                }

                ////////////////////////////////////////////////////////
                // Check whether the user wants Panfactum to host the domain
                ////////////////////////////////////////////////////////
                context.logger.info(`
                    In order for Panfactum infrastructure to run workloads that are accessible at
                    ${newDomain}, Panfactum needs to host its DNS servers.
                `)

                context.logger.warn(`
                    We do NOT recommend this if you are already hosting records under ${newDomain}
                    as this will invalidate existing DNS records.
                `)

                context.logger.write(`
                    If you choose to skip this step, you can still run workloads under subdomains such
                    as <your_subdomain>.${newDomain}, but you should re-run with these arguments:

                        pf domain add -d <your_subdomain>.${newDomain}
                `)

                const shouldHostZone = await context.logger.confirm({
                    message: `Would you like to configure Panfactum to host the DNS for ${newDomain}?`,
                })

                if (shouldHostZone) {

                    ////////////////////////////////////////////////////////
                    // Get environment
                    ////////////////////////////////////////////////////////
                    environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta, shouldBeProduction: true })

                    ////////////////////////////////////////////////////////
                    // Zone Setup - Manual
                    ////////////////////////////////////////////////////////

                    context.logger.info(`Deploying DNS zone for ${newDomain} in ${environmentMeta.name}...`)
                    const apexConfig = await manualZoneSetup({ context, domain: newDomain, env: environmentMeta, isApex: true })

                    ////////////////////////////////////////////////////////
                    // Environment subzones - Auto
                    ////////////////////////////////////////////////////////
                    await createEnvironmentSubzones({
                        context,
                        domain: newDomain,
                        existingDomainConfigs: {
                            ...domainConfigs,
                            ...{
                                [newDomain]: apexConfig
                            }
                        }
                    })

                } else {

                    ////////////////////////////////////////////////////////
                    // Environment subzones - Manual
                    ////////////////////////////////////////////////////////
                    await createEnvironmentSubzones({
                        context,
                        domain: newDomain,
                        existingDomainConfigs: domainConfigs
                    })
                }
            } else {

                ////////////////////////////////////////////////////////
                // Confirm purchase
                ////////////////////////////////////////////////////////
                context.logger.info(`${newDomain} has not been added, and it also has not yet been purchased.`)

                const shouldRegister = await context.logger.confirm({
                    message: `Would you like to use Panfactum to purchase ${newDomain}?`
                })

                if (!shouldRegister) {
                    context.logger.error(`
                        Cannot add ${newDomain} if it has not been purchased!

                        While you do not need to use this CLI to purchase the domain, you will need to purchase
                        it via an alternative mechanism such as the AWS web console:

                        https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/domain-register.html

                        Note that AWS does not support registering domains on all TLDs, so you may need to use an alternative registrar
                        such as https://www.namecheap.com/.

                        Either way, once you have purchased ${newDomain}, run this command to continue adding the domain to
                        this Panfactum installation:

                        pf domain add -d ${newDomain} ${environmentMeta ? `-e ${environmentMeta.name}` : ""}
                    `)
                    return 1
                }

                ////////////////////////////////////////////////////////
                // Choose environment
                ////////////////////////////////////////////////////////
                environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta, shouldBeProduction: true })


                ////////////////////////////////////////////////////////
                // Purchase the domain
                ////////////////////////////////////////////////////////
                const registeredDomainConfig = await registerDomain({ context, env: environmentMeta, domain: newDomain, tld })

                ////////////////////////////////////////////////////////
                // Setup environment zones - Auto
                ////////////////////////////////////////////////////////
                await createEnvironmentSubzones({
                    context,
                    domain: newDomain,
                    existingDomainConfigs: {
                        ...domainConfigs,
                        ...{
                            [newDomain]: registeredDomainConfig
                        }
                    }
                })
            }

        } else {

            // Note that this handles the case where there could be multiple ancestors 
            // (e.g., `a.prod.panfactum.com` has ancestors `prod.panfactum.com` and `panfactum.com`)
            // For the below logic to work, we want to select "first" ancestor which will be the longest ancestor domain
            const [ancestorDomain, existingAncestorConfig] = Object.entries(domainConfigs)
                .filter(([domain]) => {
                    return newDomain.endsWith(`.${domain}`)
                })
                .sort(([domainA], [domainB]) => domainB.length - domainA.length)[0] ?? []

            if (ancestorDomain && existingAncestorConfig) {
                ////////////////////////////////////////////////////////
                // If subdomain and has ancestor configured with Panfactum,
                // create a new zone for the subdomain and link to nearest ancestor
                ////////////////////////////////////////////////////////
                context.logger.info(`
                    Confirmed! You've already added its ancestor
                    ${ancestorDomain} in ${existingAncestorConfig.env.name}.
                `)
                environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta })

                ////////////////////////////////////////////////////////
                // Connect with parent
                ////////////////////////////////////////////////////////
                context.logger.info(`Deploying DNS zone for ${newDomain} in ${environmentMeta.name}...`)
                await createDescendentZones({
                    context,
                    ancestorZone: existingAncestorConfig,
                    descendentZones: {
                        [newDomain]: {
                            env: environmentMeta
                        }
                    }
                })

                ////////////////////////////////////////////////////////
                // Skip environment subzone setup
                //
                // If the user is adding a subdomain and has already
                // added one of its ancestors, it seems very
                // unlikely that they want to set up environment subzones
                //
                // TODO: Add a flag to force this
                ////////////////////////////////////////////////////////

            } else {

                context.logger.info(`You haven't added ${newDomain} or any ancestor domains.`)

                ////////////////////////////////////////////////////////
                // If no ancestor configured with Panfactum BUT the apex is registered,
                // let's check to see if the user want to connect the apex to Panfactum.
                ////////////////////////////////////////////////////////
                if (forceIsRegistered || await isRegistered({ domain: apexDomain, context })) {
                    context.logger.write(`However, it appears the apex domain for ${newDomain} (${apexDomain}) has already been purchased.`)

                    ////////////////////////////////////////////////////////
                    // Confirm the user is the owner
                    ////////////////////////////////////////////////////////

                    const ownsDomain = await context.logger.confirm({
                        message: `Are you the owner of ${apexDomain}?`,
                    })

                    if (!ownsDomain) {
                        context.logger.error(`You cannot add ${newDomain} to Panfactum unless you own its apex domain ${apexDomain}.`)
                        return 1
                    }

                    ////////////////////////////////////////////////////////
                    // (Optional) Link the apex zone to the domain registration
                    ////////////////////////////////////////////////////////
                    context.logger.info(`
                        Would you like to configure Panfactum to host the DNS servers for ${apexDomain}?
                        This isn't required to add ${newDomain}, but it will make adding
                        additional subdomains of ${apexDomain} easier in the future.
                    `)

                    context.logger.warn(`
                        We do NOT recommend this if you are already hosting records under ${apexDomain}
                        as you this will invalidate existing DNS records.
                    `)

                    const shouldHostApexZone = await context.logger.confirm({
                        message: `Would you like to configure Panfactum to host the DNS for ${apexDomain}?`,
                        default: true
                    })

                    if (shouldHostApexZone) {

                        ////////////////////////////////////////////////////////
                        // Select environment for the apex domain - should be prod
                        ////////////////////////////////////////////////////////
                        const apexEnvironmentMeta = await getEnvironmentForZone({ context, domain: apexDomain, shouldBeProduction: true })

                        ////////////////////////////////////////////////////////
                        // Apex Zone Setup - Manual
                        ////////////////////////////////////////////////////////
                        const apexConfig = await manualZoneSetup({ context, domain: apexDomain, env: apexEnvironmentMeta, isApex: true })

                        ////////////////////////////////////////////////////////
                        // User-specified DNS Zone Setup - Auto
                        ////////////////////////////////////////////////////////
                        environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta })

                        const descendentConfigs = await createDescendentZones({
                            context,
                            ancestorZone: apexConfig,
                            descendentZones: {
                                [newDomain]: {
                                    env: environmentMeta
                                }
                            }
                        })

                        ////////////////////////////////////////////////////////
                        // Environment subzones for user-specified Zone - Auto
                        ////////////////////////////////////////////////////////
                        await createEnvironmentSubzones({
                            context,
                            domain: newDomain,
                            existingDomainConfigs: {
                                ...domainConfigs,
                                ...descendentConfigs
                            },
                        })


                    } else {
                        ////////////////////////////////////////////////////////
                        // Select environment for the new domain
                        ////////////////////////////////////////////////////////
                        environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta })


                        ////////////////////////////////////////////////////////
                        // User-specified Zone Setup - Manual
                        ////////////////////////////////////////////////////////
                        const domainConfig = await manualZoneSetup({ context, domain: newDomain, env: environmentMeta })

                        ////////////////////////////////////////////////////////
                        //  Environment subzones for user-specified Zone - Auto
                        ////////////////////////////////////////////////////////
                        await createEnvironmentSubzones({
                            context,
                            domain: newDomain,
                            existingDomainConfigs: {
                                ...domainConfigs,
                                ...{
                                    [newDomain]: domainConfig
                                }
                            }
                        })
                    }

                } else {
                    context.logger.write(`Moreover, it appears the apex domain for ${newDomain} (${apexDomain}) is available for purchase.`)

                    ////////////////////////////////////////////////////////
                    // If the apex is not registered,
                    // let's check to see if the user want to purchase it.
                    ////////////////////////////////////////////////////////
                    const shouldPurchase = await context.logger.confirm({
                        message: `Would you like to purcahse ${apexDomain}?`
                    })

                    if (!shouldPurchase) {
                        context.logger.error(`You cannot add ${newDomain} to Panfactum unless you own its apex domain ${apexDomain}.`)
                        return 1
                    }

                    ////////////////////////////////////////////////////////
                    // Pick environment for apex domain - should be prod
                    ////////////////////////////////////////////////////////
                    const apexEnvironmentMeta = await getEnvironmentForZone({ context, domain: apexDomain, shouldBeProduction: true })

                    ////////////////////////////////////////////////////////
                    // Purchase it
                    ////////////////////////////////////////////////////////
                    const registeredDomainConfig = await registerDomain({ context, env: apexEnvironmentMeta, domain: apexDomain, tld })

                    ////////////////////////////////////////////////////////
                    // Select environment for the new domain
                    ////////////////////////////////////////////////////////
                    environmentMeta = await getEnvironmentForZone({ context, domain: newDomain, environmentMeta })

                    ////////////////////////////////////////////////////////
                    // User-specified DNS Zone Setup - Auto
                    ////////////////////////////////////////////////////////
                    const descendentConfigs = await createDescendentZones({
                        context,
                        ancestorZone: registeredDomainConfig,
                        descendentZones: {
                            [newDomain]: {
                                env: environmentMeta
                            }
                        }
                    })

                    ////////////////////////////////////////////////////////
                    // Environment Subzones Setup - Auto
                    ////////////////////////////////////////////////////////
                    await createEnvironmentSubzones({
                        context,
                        domain: newDomain,
                        existingDomainConfigs: {
                            ...domainConfigs,
                            ...descendentConfigs
                        },
                    })
                }
            }
        }

        return 0
    }
}