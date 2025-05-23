import { z } from "zod";

export const PANFACTUM_YAML_SCHEMA = z
    .object({
        // Required fields
        repo_name: z.string({
            required_error: "repo_name must be set in panfactum.yaml",
        }),

        repo_primary_branch: z.string({
            required_error: "repo_primary_branch must be set in panfactum.yaml",
        }),

        repo_url: z
            .string({
                required_error: "repo_url must be set in panfactum.yaml",
            })
            .refine(
                (url) =>
                    url.startsWith("git::https://") ||
                    url.startsWith("github.com") ||
                    url.startsWith("bitbucket.org"),
                {
                    message:
                        "repo_url must be a valid TF module source that uses HTTPS. See https://opentofu.org/docs/language/modules/sources.",
                }
            ),

        // Optional directory fields with path validation
        environments_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "environments_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "environments_dir must not contain a trailing /",
            })
            .default("environments"),

        iac_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "iac_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "iac_dir must not contain a trailing /",
            })
            .default("infrastructure"),

        aws_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "aws_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "aws_dir must not contain a trailing /",
            })
            .default(".aws"),

        kube_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "kube_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "kube_dir must not contain a trailing /",
            })
            .default(".kube"),

        ssh_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "ssh_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "ssh_dir must not contain a trailing /",
            })
            .default(".ssh"),

        buildkit_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "buildkit_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "buildkit_dir must not contain a trailing /",
            })
            .default(".buildkit"),

        nats_dir: z
            .string()
            .optional()
            .refine((dir) => !dir?.startsWith("/"), {
                message: "nats_dir must not contain a leading /",
            })
            .refine((dir) => !dir?.endsWith("/"), {
                message: "nats_dir must not contain a trailing /",
            })
            .default(".nats"),
        installation_id: z.string().uuid().optional()
    })