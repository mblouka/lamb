import { promises as fs } from "node:fs"
import path from "node:path"
import vm from "node:vm"

import { compile } from "@mdx-js/mdx"
import { renderToString } from "preact-render-to-string"
import * as jsxRuntime from "preact/jsx-runtime"

import { LambConfig } from "./config"
import { LambScope } from "./scope"
import { transformJsCode } from "./transform"

type LambPageRenderer = (params: any, htmlBody?: string) => Promise<string>

/** @type {new (code: string, ...args: Array<unknown>) => Function} **/
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

/**
 * Represents a page.
 */
export interface LambPage {
  /**
   * Path of page relative to root directory.
   */
  path: string

  /**
   * Slug of page. Used instead of the name in path (if defined).
   */
  slug: string

  /**
   * Markdown, JSX or html component?
   */
  type: "md" | "js" | "html"

  /**
   * Function to render this page.
   */
  renderer: LambPageRenderer
}

function resolveEvaluateOptions(options: any) {
  const {
    Fragment,
    baseUrl,
    development,
    jsx,
    jsxDEV,
    jsxs,
    useMDXComponents,
    ...rest
  } = options || {}

  if (!Fragment) throw new Error("Expected `Fragment` given to `evaluate`")
  if (development) {
    if (!jsxDEV) throw new Error("Expected `jsxDEV` given to `evaluate`")
  } else {
    if (!jsx) throw new Error("Expected `jsx` given to `evaluate`")
    if (!jsxs) throw new Error("Expected `jsxs` given to `evaluate`")
  }

  return {
    compiletime: {
      ...rest,
      development,
      outputFormat: "function-body",
      providerImportSource: useMDXComponents ? "#" : undefined,
    },
    runtime: { Fragment, baseUrl, jsx, jsxDEV, jsxs, useMDXComponents },
  }
}

export async function makePage(config: LambConfig, pathToPage: string) {
  const pathinfo = path.parse(pathToPage)

  let renderer: LambPageRenderer
  let slug = pathinfo.name
  let type: LambPage["type"]

  // Parse markdown or js?
  if (pathinfo.ext === ".md") {
    type = "md"

    const markdownContents = await fs.readFile(pathToPage, "utf-8")

    // TODO: Obtain frontmatter from this (and fill in config).
    // TODO: Babeling for import shit.

    const { compiletime, runtime } = resolveEvaluateOptions(jsxRuntime)
    const parsedMdx = await compile(markdownContents, compiletime)
    const compiledMdx = new AsyncFunction(String(parsedMdx))

    console.log(compiledMdx.toString())

    //console.log(await transformJsCode(config, parsedMdx.toString(), pathToPage))

    renderer = async (params, htmlBody) => {
      let contents = renderToString(
        (await compiledMdx(runtime)).default(params)
      )
      if (htmlBody) {
        contents = contents.replace("{{body}}", htmlBody)
      }
      return contents
    }
  } else if (
    pathinfo.ext === ".js" ||
    pathinfo.ext === ".jsx" ||
    pathinfo.ext === ".ts" ||
    pathinfo.ext === ".tsx"
  ) {
    type = "js"

    const jsCode = await fs.readFile(pathToPage, "utf-8")
    const transformedJsCode = await transformJsCode(config, jsCode, pathToPage)
    const compiledJsx = await new AsyncFunction(transformedJsCode)()

    renderer = async (params, htmlBody) => {
      return renderToString(compiledJsx({ body: htmlBody, ...params }))
    }
  } else if (pathinfo.ext === ".html") {
    type = "html"
    const htmlContents = await fs.readFile(pathToPage, "utf-8")
    renderer = async (params, htmlBody) => {
      return htmlBody === undefined
        ? htmlContents
        : htmlContents.replace("{{body}}", htmlBody)
    }
  } else {
    throw new Error("Unrecognized file type.")
  }

  return { path: pathToPage, slug, type, renderer } as LambPage
}
