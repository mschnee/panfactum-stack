import { join } from "node:path";
import { stringify, parse } from "yaml";
import { ZodError, type z } from "zod";
import { REPO_CONFIG_FILE } from "./constants";
import { PANFACTUM_YAML_SCHEMA } from "./schemas";
import { CLIError, PanfactumZodError } from "../error/error";
import { writeFile } from "../fs/writeFile";
import type { PanfactumContext } from "@/util/context/context";

const OPTIONAL_PANFACTUM_YAML_SCHEMA = PANFACTUM_YAML_SCHEMA.partial();

interface UpsertRepoVariablesInput {
    context: PanfactumContext;
    values: z.infer<typeof OPTIONAL_PANFACTUM_YAML_SCHEMA>;
}

export async function upsertRepoVariables(input: UpsertRepoVariablesInput) {
    const { values, context } = input;

    /////////////////////////////////////////////
    // Update panfactum.yaml
    /////////////////////////////////////////////
    const yamlOpts = {
        doubleQuotedAsJSON: true,
    }
    const configFilePath = join(context.repoVariables.repo_root, REPO_CONFIG_FILE)

    const explainer = "# These are the standard repo variables required by\n" +
        "# https://panfactum.com/docs/reference/repo-variables\n\n"

    try {
        if (await Bun.file(configFilePath).exists()) {
            const fileContent = await Bun.file(configFilePath).text();
            const existingValues = parse(fileContent);
            await writeFile({
                path: configFilePath,
                contents: explainer + stringify({
                    ...existingValues,
                    ...OPTIONAL_PANFACTUM_YAML_SCHEMA.parse(values)
                }, yamlOpts),
                context,
                overwrite: true
            })
        } else {
            await writeFile({
                path: configFilePath,
                contents: explainer + stringify(OPTIONAL_PANFACTUM_YAML_SCHEMA.parse(values), yamlOpts),
                context,
                overwrite: true
            })
        }
    } catch (e) {
        if (e instanceof ZodError) {
            throw new PanfactumZodError("Failed to validate repo variables", "upsertRepoVariables", e)
        } else {
            throw new CLIError(`Failed to write new repo variables to ${configFilePath}`, e)
        }
    }

    /////////////////////////////////////////////
    // Update the context
    /////////////////////////////////////////////
    Object.entries(values).forEach(([key, val]) => {
        context.repoVariables[key as keyof z.infer<typeof PANFACTUM_YAML_SCHEMA>] = val
    })
}