import fs from "node:fs"
import path from "node:path"

import babel, { types as t, NodePath } from "@babel/core"
import { glob } from "glob"
import yaml from "yaml"

import { LambConfig } from "./config"

interface Frontmatter {
  [key: string]: string
}

function extractFrontmatter(content: string): Frontmatter {
  const parts = content.toString().split(/---\r?\n/g)
  if (parts.length >= 3) {
    return yaml.parse(parts[1])
  }
  return {}
}

// TODO: Other things than just .md, like .json, .jsx, .ts, and .tsx.
function pluginToProcessSpecialImports() {
  return {
    visitor: {
      ImportDeclaration(
        npath: NodePath<t.ImportDeclaration>,
        state: babel.PluginPass
      ) {
        const importPath = npath.node.source.value
        if (importPath.endsWith("*.md")) {
          const directoryPath = path.dirname(state.file.opts.filename!)
          const files = glob
            .sync(importPath, { cwd: directoryPath })
            .map((subpath) => path.join(directoryPath, subpath))

          const pages = files.map((file) => {
            const content = fs.readFileSync(file, "utf8")
            const frontmatter = extractFrontmatter(content)
            return { path: file, filename: path.basename(file), ...frontmatter }
          })

          npath.replaceWith(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                t.identifier(npath.node.specifiers[0].local.name),
                t.arrayExpression(
                  pages.map((page) =>
                    t.objectExpression(
                      Object.entries(page).map(([key, value]) =>
                        t.objectProperty(
                          t.identifier(key),
                          t.stringLiteral(value)
                        )
                      )
                    )
                  )
                )
              ),
            ])
          )
        }
      },
    },
  }
}

function pluginToConvertIntoDynamicImports() {
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
}

export async function transformJsCode(
  config: LambConfig,
  code: string,
  pathToFile: string
) {
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
      pluginToProcessSpecialImports,
      pluginToConvertIntoDynamicImports,
    ],
    filename: pathToFile,
  })
  return result?.code!
}
