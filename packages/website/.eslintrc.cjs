module.exports = {
  root: true,
  plugins: [
    "unused-imports",
    "mdx",
    "css-modules"
  ],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:jsx-a11y/recommended",
    "plugin:astro/recommended",
    "plugin:css-modules/recommended"
  ],
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: ['./tsconfig.json'],
    extraFileExtensions: ['.astro', '.mdx', '.css'],
    ecmaFeatures: {
      jsx: true,
      ecmaVersion: "latest"
    }
  },
  ignorePatterns: [
    "*.js", "*.cjs", "*.mjs", "*.md", "*.png", "**/*.mdx/*.ts",
    "**/*.mdx/*.tsx"
  ],
  rules: {
    "no-console": "error",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "unused-imports/no-unused-imports": "error",
    "unused-imports/no-unused-vars": [
      "error",
      {
        "vars": "all",
        "varsIgnorePattern": "^_",
        "args": "after-used",
        "argsIgnorePattern": "^_",
      },
    ],
    "import/order": ["error", {
      "groups": [
        "external",
        "internal"
      ],
      "newlines-between": "always",
      "alphabetize": {
        "order": "asc"
      }
    }],
    "import/no-unresolved": [2, {
      ignore: [
        'astro:.*$',
        '.*?raw$'
      ]
    }],
    "better-tailwindcss/enforce-consistent-variable-syntax": "error",
    "better-tailwindcss/no-unregistered-classes": ["error", {
      "ignore": [
        "content", // For the markdown content for articles
        "masonry-item", // For the masonry layout library
        "masonry-sizer", // For the masonry layout library
        "group", // For tailwind groups
        "subtitle" // For article subtitles
      ]
    }]
  },
  settings: {
    "import/resolver": {
      "typescript": {
        project: "./tsconfig.json"
      },
      "node": true,
    },
    "import/extensions": [
      ".ts",
      ".tsx",
      ".mdx"
    ],
    "import/parsers": {
      "@typescript-eslint/parser": [".ts", ".tsx"],
    },
    "better-tailwindcss": {
      entryPoint: "src/styles/global.css"
    }
  },
  overrides: [
    {
      files: ["*.mdx"],
      extends: [
        "plugin:mdx/recommended",
        // Disable type checking for MDX files as they don't support TypeScript type checking
        "plugin:@typescript-eslint/disable-type-checked"
      ],
      settings: {
        "mdx/code-blocks": false,
        "mdx/language-mapper": {},
      },
      parser: "eslint-mdx",
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      },
      rules: {

        // You might want to disable some rules that don't work well with MDX
        "no-unused-expressions": "off",
        "react/jsx-no-undef": "off",

        // Import rules for MDX
        "import/no-unresolved": "off",
        "import/order": "off",
        "unused-imports/no-unused-imports": "off",

        // If you want to enforce specific MDX style rules
        "mdx/remark": [
          "error"
        ]
      }
    },
    {
      files: ["*.tsx"],
      plugins: [
        "@typescript-eslint",
        "solid",
        "prettier",
        "better-tailwindcss"
      ],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      extends: [
        "plugin:better-tailwindcss/recommended-error"
      ],
      rules: {
        // Prettier
        "prettier/prettier": "error",

        // identifier usage is important
        "solid/jsx-no-duplicate-props": 2,
        "solid/jsx-no-undef": [2, { typescriptEnabled: true }],
        "solid/jsx-uses-vars": 2,
        // security problems
        "solid/no-innerhtml": 2,
        "solid/jsx-no-script-url": 2,
        // reactivity
        "solid/components-return-once": 1,
        "solid/no-destructure": 2,
        "solid/prefer-for": 2,
        "solid/reactivity": 1,
        "solid/event-handlers": 1,
        // these rules are mostly style suggestions
        "solid/imports": 1,
        "solid/style-prop": 1,
        "solid/no-react-deps": 1,
        "solid/no-react-specific-props": 1,
        "solid/self-closing-comp": 1,
        "solid/no-array-handlers": 0,
        "solid/no-unknown-namespaces": 0,
      }
    },
    {
      files: ["*.astro"],
      plugins: ["astro"],
      // This is required b/c astro files do their own fancy type checking.
      // We run this via `astro check`, so it is unnecessary for eslint to run it
      // AND eslint will actually incorrect certain imports (e.g., images) as any which
      // will cause issues
      extends: ['plugin:@typescript-eslint/disable-type-checked'],
      env: {
        node: true,
        "astro/astro": true,
        es2020: true,
      },
      processor: "astro/client-side-ts",
      parser: "astro-eslint-parser",
      parserOptions: {
        parser: "@typescript-eslint/parser",
        extraFileExtensions: [".astro"],
        // The script of Astro components uses ESM.
        sourceType: "module",
      },
      rules: {
        "astro/no-conflict-set-directives": "error",
        "astro/no-unused-define-vars-in-style": "error",
      },
    },
    {
      // Define the configuration for `<script>` tag when using `client-side-ts` processor.
      // Script in `<script>` is assigned a virtual file name with the `.ts` extension.
      files: ["**/*.astro/*.ts", "*.astro/*.ts"],
      env: {
        browser: true,
        es2020: true,
      },
      parser: "@typescript-eslint/parser",
      parserOptions: {
        sourceType: "module",
      },
      rules: {
        // If you are using "prettier/prettier" rule,
        // you don't need to format inside <script> as it will be formatted as a `.astro` file.
        "prettier/prettier": "off",
      },
    },
  ],

}