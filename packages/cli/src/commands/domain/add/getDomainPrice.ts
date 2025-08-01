import { ListPricesCommand } from "@aws-sdk/client-route-53-domains";
import { getRoute53DomainsClient } from "@/util/aws/clients/getRoute53DomainsClient";
import { getIdentity } from "@/util/aws/getIdentity";
import { getPanfactumConfig } from "@/util/config/getPanfactumConfig";
import { CLIError } from "@/util/error/error";
import type { IEnvironmentMeta } from "@/util/config/getEnvironments";
import type { PanfactumContext } from "@/util/context/context";

/**
 * Interface for getDomainPrice function inputs
 */
interface IGetDomainPriceInputs {
  /** Panfactum context for logging and configuration */
  context: PanfactumContext;
  /** Environment metadata for AWS profile lookup */
  env: IEnvironmentMeta;
  /** Top-level domain to get pricing for */
  tld: string;
}

export async function getDomainPrice(inputs: IGetDomainPriceInputs): Promise<number> {
    const { context, env, tld } = inputs;

    const { aws_profile: profile } = await getPanfactumConfig({ context, directory: env.path });
    if (!profile) {
        throw new CLIError(`Was not able to find AWS profile for '${env.name}' environment`);
    }

    await getIdentity({ context, profile })
        .catch((error: unknown) => {
            throw new CLIError(
                `Was not able to authenticate with AWS profile '${profile}'`,
                error
            );
        });

    const route53DomainsClient = await getRoute53DomainsClient({ context, profile })
        .catch((error: unknown) => {
            throw new CLIError(
                `Failed to create Route53 Domains client for profile '${profile}'`,
                error
            );
        });
        
    const listPricesCommand = new ListPricesCommand({
        Tld: tld,
    });

    const priceResponse = await route53DomainsClient.send(listPricesCommand)
        .catch((error: unknown) => {
            throw new CLIError(
                `Failed to get pricing information for TLD .${tld}`,
                error
            );
        });
    
    if (priceResponse.Prices?.length) {
        const registrationPrice = priceResponse.Prices.find(
            (price) => price.RegistrationPrice?.Price !== undefined
        )?.RegistrationPrice?.Price;
        if (registrationPrice !== undefined) {
            return registrationPrice;
        }
    }

    throw new CLIError(`No registration prices returned for TLD .${tld}`);
}