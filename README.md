<p>
<img src="./assets/logo.png" align="right" width="128">
<h1>Lamb</h1>
<p>Straightforward, extensible, zero configuration <b>public domain</b> static site generator, written in modern TypeScript. Just point Lamb to your site's directory and upload the contents of <code>/out</code> to your host. Comes with a few fancy tricks to make your life easier, such as a handy special import syntax and NextJS-style filesystem routing (with support for MDX and JSX!)
</p>
</p>

**[➔ Lamb complements Ashley, the general purpose & public domain forum software](https://github.com/mblouka/ashley)** that aims to be simple, correct, consistent, and complete. We highly recommend you check it out!

> [!IMPORTANT]
> This is WIP software and is not ready for production. You shouldn't use this as anything but a toy at the moment. This document serves as a roadmap, and not necessarily as a list of currently available features.

## Overview
- **Use Markdown, [MDX](https://mdxjs.com/), [JSX](https://react.dev/learn/writing-markup-with-jsx), or HTML.** Bring in your favorite web technologies and libraries and they will be bundled into your site.
- **Routing is based on files and directories.** `index.md` compiles into `index.html`, and `/my/favorite/directory/yay.md` compiles into `/my/favorite/directory/yay.html`.
- **Use components instead of Markdown.** Export a component from a page ending in `.js`/`.ts`/`.jsx`/`.tsx` and it will be rendered, similarly to the Pages router for NextJS.
- **Layouts for every directory.** Create a special `_layout.html` (or any of the other supported formats) in any directory to provide a directory-specific layout.
- **Special import syntax.** Need to generate content based on the structure of your site, like an index page listing all blog posts? Use `import posts from "./*.md"` to import all frontmatters in the directory and do stuff with them.
- **Live server.** Use `lamb dev` and navigate to the URL it prints. All changes will be automatically compiled and your browser will reload afterwards.

## Usage

### Installation

#### Using a binary
It is possible to run Lamb on its own by downloading a binary for your platform from the Releases page. They are, however, experimental.

#### Using `npm`
Install Lamb globally from `npm` using the following command.
```
npm install @mblouka/lamb -g
```

### Creating a project
You can install a project in any directory using the `lamb init` command. This will create a default project configuration in the **current** directory, with an `index.md` page, a `_layout.html` root layout, and a `_layout.css` default stylesheet.

### Building a project
Simply run `lamb` in the current directory. When no arguments are passed, `lamb` will just assume you want to build your project. By default, files will be output into `/out`, but you can change this by altering the `lamb.config.json` file, which is optional.

## License
This is free and unencumbered software released into the public domain. For more information, read the [full license](./LICENSE).