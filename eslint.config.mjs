import config from "@iobroker/eslint-config";

export default [
  ...config,
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "vendor/**",
    ],
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": [
        "warn",
        {
          publicOnly: true,
          require: {
            ClassDeclaration: true,
            MethodDefinition: true,
            FunctionDeclaration: true,
            ArrowFunctionExpression: false,
            ClassExpression: false,
            FunctionExpression: false,
          },
          contexts: ["TSInterfaceDeclaration"],
        },
      ],
    },
  },
];
