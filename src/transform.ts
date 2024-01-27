import fs from "node:fs"
import path from "node:path"

import babel, { types as t, NodePath } from "@babel/core"
import { glob } from "glob"
import yaml from "yaml"

import { LambConfig } from "./config"

//===========================================================================
// Utility functions.
//===========================================================================

function valueToBabelExpr(value: any): babel.types.Expression {
  if (typeof value === "string") {
    return t.stringLiteral(value)
  } else if (typeof value === "number") {
    return t.numericLiteral(value)
  } else if (typeof value === "boolean") {
    return t.booleanLiteral(value)
  } else if (Array.isArray(value)) {
    return t.arrayExpression(value.map(valueToBabelExpr))
  } else if (value === null) {
    return t.nullLiteral()
  } else if (typeof value === "object" && value !== null) {
    return t.objectExpression(
      Object.keys(value).map((key) =>
        t.objectProperty(t.identifier(key), valueToBabelExpr(value[key]))
      )
    )
  } else {
    throw new Error("Unsupported value type")
  }
}

//===========================================================================
// Babel plugins.
//===========================================================================

export type SupportedInhousePlugins = keyof typeof InhousePlugins
type InhousePluginsOptionsMap = {
  [K in keyof typeof InhousePlugins]: Parameters<(typeof InhousePlugins)[K]>[0]
}

const InhousePlugins = {
  /**
   * Plugin for converting ESM inline imports into dynamic imports.
   * This is necessary due to eval()'ing of the JSX modules.
   */
  ConvertToDynamicImports() {
    return {
      visitor: {
        ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
          const source = path.node.source.value
          const importSpecifiers = path.node.specifiers

          importSpecifiers.forEach((specifier) => {
            if (
              t.isImportDefaultSpecifier(specifier) ||
              t.isImportSpecifier(specifier)
            ) {
              // Create the dynamic import statement
              const importStatement = t.awaitExpression(
                t.callExpression(t.import(), [t.stringLiteral(source)])
              )

              // Create a variable declaration to destructure the specific import
              const variableDeclarator = t.variableDeclarator(
                t.objectPattern([
                  t.objectProperty(
                    //@ts-ignore
                    t.identifier(specifier.imported.name),
                    t.identifier(specifier.local.name),
                    false,
                    true
                  ),
                ]),
                importStatement
              )

              // Replace the original import declaration with the new dynamic import
              path.replaceWith(
                t.variableDeclaration("const", [variableDeclarator])
              )
            }
          })
        },
        ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
          const declaration = path.node.declaration
          let expression

          // Convert FunctionDeclaration to FunctionExpression
          if (t.isFunctionDeclaration(declaration)) {
            expression = t.functionExpression(
              declaration.id!, // Anonymize the function name
              declaration.params,
              declaration.body,
              declaration.generator,
              declaration.async
            )
          } else {
            expression = declaration
          }

          path.replaceWith(t.returnStatement(expression as t.Expression))
        },
      },
    }
  },

  /**
   * Plugin for processing special imports.
   * TODO: Other things than just .md, like .json, .jsx, .ts, and .tsx.
   */
  SpecialImports(opts: {
    /**
     * Custom loaders.. Return either a string or an object.
     */
    loaders: Record<string, (filepath: string) => string | object>
  }) {
    return {
      visitor: {
        ImportDeclaration(
          npath: NodePath<t.ImportDeclaration>,
          state: babel.PluginPass
        ) {
          const importPath = npath.node.source.value
          const loader = opts.loaders[path.parse(importPath).ext]

          let value
          if (loader !== undefined) {
            if (importPath.includes("*")) {
              // Glob, values will be in an array.
              const directoryPath = path.dirname(state.file.opts.filename!)
              const files = glob
                .sync(importPath, { cwd: directoryPath })
                .map((subpath) => path.join(directoryPath, subpath))
              value = files.map(loader)
            } else {
              // Non-glob, import a single file.
              value = loader(importPath)
            }
          }

          npath.replaceWith(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                t.identifier(npath.node.specifiers[0].local.name),
                valueToBabelExpr(value)
              ),
            ])
          )
        },
      },
    }
  },
}

export default async function transform(
  config: LambConfig,
  opts: Partial<InhousePluginsOptionsMap>,
  code: string,
  pathToFile: string
) {
  // Prepare the plugins.
  const plugins = []
  for (const [pluginName, pluginOpts] of Object.entries(opts)) {
    plugins.push([
      InhousePlugins[pluginName as keyof typeof InhousePlugins],
      pluginOpts,
    ])
  }

  // Transform the code.
  const result = await babel.transformAsync(code, {
    presets: [
      [
        "@babel/preset-env",
        {
          modules: false,
        },
      ],
      "@babel/preset-typescript",
    ],
    plugins: [
      [
        "@babel/plugin-transform-react-jsx",
        {
          runtime: "automatic",
          importSource: "preact",
        },
      ],
      ...plugins,
    ],
    filename: pathToFile,
  })
  return result?.code!
}
