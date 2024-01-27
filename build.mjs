import esbuild from "esbuild"

async function build() {
  await esbuild.build({
    entryPoints: ["./src/index.ts"],
    outdir: "./dist",
    platform: "node",
    packages: "external",
    format: "esm",
    bundle: true,
  })
}

build().catch(console.error)
