import { ListPricesCommand } from "@aws-sdk/client-route-53-domains";
import { getPanfactumConfig } from "@/commands/config/get/getPanfactumConfig";
import { getRoute53DomainsClient } from "@/util/aws/clients/getRoute53DomainsClient";
import { getIdentity } from "@/util/aws/getIdentity";
import { CLIError } from "@/util/error/error";
import type { EnvironmentMeta } from "@/util/config/getEnvironments";
import type { PanfactumContext } from "@/util/context/context";

export async function getDomainPrice(inputs: {
    context: PanfactumContext;
    env: EnvironmentMeta;
    tld: string;
}): Promise<number> {
    const { context, env, tld } = inputs;

    const { aws_profile: profile } = await getPanfactumConfig({ context, directory: env.path });
    if (!profile) {
        throw new CLIError(`Was not able to find AWS profile for '${env.name}' environment`);
    }

    try {
        await getIdentity({ context, profile });
    } catch (error) {
        throw new CLIError(`Was not able to authenticate with AWS profile '${profile}'`, error);
    }

    try {
        const route53DomainsClient = await getRoute53DomainsClient({ context, profile })
        const listPricesCommand = new ListPricesCommand({
            Tld: tld,
        });

        const priceResponse = await route53DomainsClient.send(listPricesCommand);

        if (priceResponse.Prices?.length) {
            const registrationPrice = priceResponse.Prices.find(
                (price) => price.RegistrationPrice?.Price !== undefined
            )?.RegistrationPrice?.Price;
            if (registrationPrice !== undefined) {
                return registrationPrice
            }
        }

        throw new CLIError(`No registration prices returned`);
    } catch (error) {
        throw new CLIError(`Failed to get pricing information for TLD .${tld}`, error);
    }
}