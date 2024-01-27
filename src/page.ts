import { promises as fs } from "node:fs"
import path from "node:path"

import { compile } from "@mdx-js/mdx"
import remarkFrontmatter from "remark-frontmatter"
import { renderToString } from "preact-render-to-string"
import * as jsxRuntime from "preact/jsx-runtime"
import { Parser as HTRParser } from "html-to-react"
import { Parser as HTMLParser } from "htmlparser2"

import { LambConfig } from "./config"
import { transformJsCode } from "./transform"

type LambPageRenderer = (params: any, htmlBody?: string) => Promise<string>

const AsyncFunction: new (code: string, ...args: Array<unknown>) => Function =
  Object.getPrototypeOf(async () => {}).constructor

type LambPageContents = string | Function

type LambPageType = "md" | "js" | "html"

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
  type: LambPageType

  /**
   * Frontmatter of page.
   */
  frontmatter: Record<string, any>

  /**
   * Contents of page.
   */
  contents: LambPageContents

  /**
   * Function to render this page.
   */
  renderer: LambPageRenderer
}

//===========================================================================
// JSX boilerplate for MDX.
//===========================================================================

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
const { compiletime, runtime } = resolveEvaluateOptions(jsxRuntime)

//===========================================================================
// Page renderers.
//===========================================================================

async function renderHtmlPage(
  config: LambConfig,
  page: LambPage,
  params: any,
  htmlBody?: string
) {
  const contents = page.contents as string
  return htmlBody === undefined
    ? contents
    : contents.replace("{{body}}", htmlBody)
}

async function renderMarkdownPage(
  config: LambConfig,
  page: LambPage,
  params: any,
  htmlBody?: string
) {
  const compiledJsx = page.contents as Function
  let contents = renderToString((await compiledJsx(runtime)).default(params))
  if (htmlBody) {
    contents = contents.replace("{{body}}", htmlBody)
  }
  return contents
}

async function renderJavascriptPage(
  config: LambConfig,
  page: LambPage,
  params: any,
  htmlBody?: string
) {
  const compiledJsx = page.contents as Function
  const children =
    htmlBody !== undefined ? HTRParser().parse(htmlBody) : undefined
  return renderToString(compiledJsx({ children, ...params }))
}

export async function renderPage(
  config: LambConfig,
  page: LambPage,
  params: any,
  htmlBody?: string
) {
  if (page.type === "html") {
    return renderHtmlPage(config, page, params, htmlBody)
  } else if (page.type === "md") {
    return renderMarkdownPage(config, page, params, htmlBody)
  } else if (page.type === "js") {
    return renderJavascriptPage(config, page, params, htmlBody)
  } else {
    throw new Error(`Invalid type "${page.type}"`)
  }
}

//===========================================================================
// Page template processors.
//===========================================================================

export async function makeHtmlPage(config: LambConfig, pathToPage: string) {
  const parsedPath = path.parse(pathToPage)
  const htmlContents = await fs.readFile(pathToPage, "utf-8")

  // The HTML frontmatter is built through <meta> tags.
  let frontmatter: Record<string, any> = {}

  // Use htmlparser2's efficient allocation to process frontmatter.
  new HTMLParser({
    onopentag(name, attribs) {
      if (
        name === "meta" &&
        attribs.name != undefined &&
        attribs.content != undefined
      ) {
        frontmatter[attribs.name] = attribs.content
      }
    },
  }).write(htmlContents)

  // TODO: Save results of the parse to manipulate the DOM,
  // render back to html. Currently, results are unused.

  // Create the page.
  return {
    path: pathToPage,
    slug: parsedPath.name,
    type: "html",
    frontmatter,
    contents: htmlContents,
  } as LambPage
}

export async function makeMarkdownPage(config: LambConfig, pathToPage: string) {
  const parsedPath = path.parse(pathToPage)
  const markdownContents = await fs.readFile(pathToPage, "utf-8")

  // TODO: Obtain frontmatter from this (and fill in config).
  // TODO: Babeling for import shit.

  // Compile the contents, locate frontmatter in "yaml" child node.
  const mdxGenerator = await compile(markdownContents, {
    ...compiletime,
    remarkPlugins: [remarkFrontmatter],
  })

  let frontmatter: Record<string, any> = {}
  console.log(mdxGenerator.value)

  //const compiledMdx = new AsyncFunction(String(mdxGenerator))
}

export async function makeJavascriptPage(
  config: LambConfig,
  pathToPage: string
) {}

export async function makePageNew(config: LambConfig, pathToPage: string) {
  const pathinfo = path.parse(pathToPage)

  // Extension processors.
  const knownProcessors: Record<LambPageType, Function> = {
    html: makeHtmlPage,
    md: makeMarkdownPage,
    js: makeJavascriptPage,
  }

  // Map of extension types.
  const knownExtensions: Record<string, LambPageType> = {
    ".md": "md",
    ".mdx": "md",
    ".htm": "html",
    ".html": "html",
    ".js": "js",
    ".jsx": "js",
    ".ts": "js",
    ".tsx": "js",
  }

  const recognized = knownExtensions[pathinfo.ext]
  if (recognized !== undefined) {
    return await knownProcessors[recognized](config, pathToPage)
  } else {
    throw new Error(`Unrecognized extension "${pathinfo.ext}"`)
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

    const parsedMdx = await compile(markdownContents, compiletime)
    const compiledMdx = new AsyncFunction(String(parsedMdx))

    //console.log(compiledMdx.toString())

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
