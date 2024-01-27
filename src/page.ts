import { promises as fs, readFileSync } from "node:fs"
import path from "node:path"

import { compile } from "@mdx-js/mdx"
import remarkFrontmatter from "remark-frontmatter"
import remarkMdxFrontmatter from "remark-mdx-frontmatter"
import { renderToString } from "preact-render-to-string"
import * as jsxRuntime from "preact/jsx-runtime"
import { Parser as HTRParser } from "html-to-react"
import { Parser as HTMLParser } from "htmlparser2"
import yaml from "yaml"

import { LambConfig } from "./config"
import transform from "./transform"
import { LambState } from "./state"
import { LambScope, getScope } from "./scope"

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
  state: LambState,
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
  state: LambState,
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
  state: LambState,
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
  state: LambState,
  page: LambPage,
  params: any,
  htmlBody?: string
) {
  if (page.type === "html") {
    return renderHtmlPage(state, page, params, htmlBody)
  } else if (page.type === "md") {
    return renderMarkdownPage(state, page, params, htmlBody)
  } else if (page.type === "js") {
    return renderJavascriptPage(state, page, params, htmlBody)
  } else {
    throw new Error(`Invalid type "${page.type}"`)
  }
}

//===========================================================================
// Page template processors.
//===========================================================================

const Loaders = {
  Markdown: (state: LambState, filepath: string) => {
    // TODO: Instead of reading from the file, see if we already parsed the file
    // and if so, extract the frontmatter from the existing parse. If parse doesn't
    // exist yet, do it right now.
    const content = readFileSync(filepath, "utf-8")
    const parts = content.toString().split(/---\r?\n/g)

    let obj: Record<string, any> = {}
    if (parts.length >= 3) {
      obj = yaml.parse(parts[1])
    }

    // Insert metadata.
    Object.assign(obj, {
      file: filepath,
    })

    return obj
  },
}

const LoaderMap = {
  ".md": Loaders.Markdown,
  ".mdx": Loaders.Markdown,
}

async function createHtmlPage(state: LambState, pathToPage: string) {
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

async function createMarkdownPage(state: LambState, pathToPage: string) {
  const parsedPath = path.parse(pathToPage)
  const markdownContents = await fs.readFile(pathToPage, "utf-8")

  // Compile the contents, locate frontmatter in "yaml" child node.
  const mdxGenerator = (
    await compile(markdownContents, {
      ...compiletime,
      remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter],
    })
  ).toString()

  // Process the code, retrieving the frontmatter in the process.
  const frontmatter: Record<string, any> = {}
  const transformedJs = await transform(
    state,
    {
      ExtractFrontmatter: frontmatter,
      // TODO: Special imports.
    },
    mdxGenerator,
    pathToPage
  )

  // Create the async function component generator.
  const contents = new AsyncFunction(String(transformedJs))

  // Create the page.
  return {
    path: pathToPage,
    slug: parsedPath.name,
    type: "md",
    frontmatter,
    contents,
  } as LambPage
}

async function createJavascriptPage(state: LambState, pathToPage: string) {
  const parsedPath = path.parse(pathToPage)
  const jsContents = await fs.readFile(pathToPage, "utf-8")

  // Process the code, retrieving the frontmatter in the process.
  const frontmatter: Record<string, any> = {}
  const transformedJs = await transform(
    state,
    {
      ExtractFrontmatter: frontmatter,
      SpecialImports: {
        loaders: LoaderMap,
        state,
      },
      ConvertToDynamicImports: {},
    },
    jsContents,
    pathToPage
  )

  // Obtain the compiled jsx.
  const contents = await new AsyncFunction(transformedJs)()

  // Create the page.
  return {
    path: pathToPage,
    slug: parsedPath.name,
    type: "js",
    frontmatter,
    contents,
  } as LambPage
}

export async function createPage(
  state: LambState,
  pathToPage: string,
  useThisScope?: LambScope
) {
  const parsed = path.parse(pathToPage)
  let scope = useThisScope
  if (scope === undefined) {
    scope = await getScope(state, parsed.dir)
  }

  // Extension processors.
  const knownProcessors: Record<LambPageType, Function> = {
    html: createHtmlPage,
    md: createMarkdownPage,
    js: createJavascriptPage,
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

  const recognized = knownExtensions[parsed.ext]
  if (recognized !== undefined) {
    return (state.filecache[pathToPage] = await knownProcessors[recognized](
      state.config,
      pathToPage
    ))
  } else {
    throw new Error(`Unrecognized extension "${parsed.ext}"`)
  }
}

export async function getPage(state: LambState, pathToPage: string) {
  const parsed = path.parse(pathToPage)
  let existingPage = state.filecache[pathToPage]
  if (existingPage === undefined) {
    existingPage = await createPage(
      state,
      pathToPage,
      await getScope(state, parsed.dir)
    )
  }
  return existingPage
}
