const gulp = require("gulp");
const path = require("path");
var fs = require("fs");
const del = require("del");
const ts = require("gulp-typescript");
const zip = require("gulp-zip");
const rename = require("gulp-rename");
const stringify = require("json-stringify-pretty-compact");
const esbuild = require("esbuild");

const GLOB = "**/*";
const DIST = "dist/";
const BUNDLE = "package/";
const SOURCE = "src/";

var PACKAGE = JSON.parse(fs.readFileSync("package.json"));

function reloadPackage(cb) {
  PACKAGE = JSON.parse(fs.readFileSync("package.json"));
  cb();
}

function DEV_DIST() {
  return path.join(PACKAGE.devDir, PACKAGE.name) + "/";
}

String.prototype.replaceAll = function (pattern, replace) {
  return this.split(pattern).join(replace);
};

function pdel(patterns, options) {
  return () => {
    return del(patterns, options);
  };
}

function plog(message) {
  return (cb) => {
    console.log(message);
    cb();
  };
}

/**
 * Run TypeScript type checking without emitting files
 */
function typeCheck() {
  return () => {
    const tsProject = ts.createProject("tsconfig.json", { noEmit: true });
    return gulp.src(SOURCE + GLOB)
      .pipe(tsProject(ts.reporter.defaultReporter()))
      .on("error", (error) => {
        console.error("TypeScript type check failed");
      });
  };
}

/**
 * Build source using esbuild - bundles all TypeScript into a single file
 */
function buildSourceEsbuild(minifySources = false, output = null) {
  return async () => {
    const outdir = output || DIST;
    await esbuild.build({
      entryPoints: ["src/macro-autocomplete.ts"],
      bundle: true,
      format: "esm",
      outfile: path.join(outdir, "macro-autocomplete.js"),
      sourcemap: true,
      sourcesContent: true,
      minify: minifySources,
      keepNames: true,
      target: "es2022",
      platform: "browser",
      logLevel: "info",
    });

    // Fix source map paths
    const jsFile = path.join(outdir, "macro-autocomplete.js");
    const mapFile = path.join(outdir, "macro-autocomplete.js.map");
    const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
    delete map.sourceRoot;
    map.sources = map.sources.map(s => {
      const match = s.match(/src\/(lib\/|macro-autocomplete\.ts).*$/);
      return match ? "src/" + match[0].substring(4) : s;
    });
    fs.writeFileSync(mapFile, JSON.stringify(map));

    // Ensure sourceMappingURL is present
    let js = fs.readFileSync(jsFile, "utf8");
    if (!js.includes("sourceMappingURL")) {
      js += "\n//# sourceMappingURL=macro-autocomplete.js.map\n";
      fs.writeFileSync(jsFile, js);
    }
  };
}

/**
 * Builds the module manifest based on the package and sources.
 */
function buildManifest(output = null) {
  return (cb) => {
    const outDir = output || DIST;
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    fs.readFile("module.json", (err, data) => {
      const module = data
        .toString()
        .replaceAll("{{name}}", PACKAGE.name)
        .replaceAll("{{title}}", PACKAGE.title)
        .replaceAll("{{version}}", PACKAGE.version)
        .replaceAll("{{description}}", PACKAGE.description);
      fs.writeFile(outDir + "module.json", module, cb);
    });
  };
}

function outputMetaFiles(output = null) {
  return () => gulp.src(["LICENSE", "README.md"], { allowEmpty: true }).pipe(gulp.dest(output || DIST));
}

/**
 * Copy files to module named directory and then compress that folder into a zip
 */
function compressDistribution() {
  return gulp.series(
    () => gulp.src(DIST + GLOB).pipe(gulp.dest(DIST + `${PACKAGE.name}/${PACKAGE.name}`)),
    () =>
      gulp
        .src(DIST + PACKAGE.name + "/" + GLOB)
        .pipe(zip(PACKAGE.name + `-v` + PACKAGE.version + ".zip"))
        .pipe(gulp.dest(BUNDLE)),
    () => gulp.src(DIST + "/module.json").pipe(gulp.dest(BUNDLE)),
    pdel(DIST + PACKAGE.name),
  );
}

exports.clean = pdel([DIST, BUNDLE]);
exports.devClean = pdel([DEV_DIST()]);

/**
 * Default Build
 */
exports.default = gulp.series(
  pdel([DIST]),
  typeCheck(),
  gulp.parallel(
    buildSourceEsbuild(false, DIST),
    buildManifest(),
    outputMetaFiles(),
  ),
);

/**
 * Dev Build - copies to Foundry modules directory
 */
exports.dev = gulp.series(
  pdel([DEV_DIST() + GLOB], { force: true }),
  typeCheck(),
  gulp.parallel(
    buildSourceEsbuild(false, DEV_DIST()),
    buildManifest(DEV_DIST()),
    outputMetaFiles(DEV_DIST()),
  ),
);

/**
 * Release Build - builds and zips
 */
exports.zip = gulp.series(
  pdel([DIST]),
  typeCheck(),
  gulp.parallel(
    buildSourceEsbuild(false, DIST),
    buildManifest(),
    outputMetaFiles(),
  ),
  compressDistribution(),
  pdel([DIST]),
);

/**
 * Watch mode
 */
exports.watch = function () {
  exports.default();
  gulp.watch(SOURCE + GLOB, buildSourceEsbuild(false, DIST));
  gulp.watch(["module.json", "package.json"], buildManifest());
  gulp.watch(["LICENSE", "README.md"], outputMetaFiles());
};

/**
 * Dev Watch mode
 */
exports.devWatch = function () {
  const devDist = DEV_DIST();
  exports.dev();
  gulp.watch(
    SOURCE + GLOB,
    gulp.series(
      plog("rebuilding with esbuild..."),
      buildSourceEsbuild(false, devDist),
      plog("sources done."),
    ),
  );
  gulp.watch(
    ["module.json", "package.json"],
    gulp.series(reloadPackage, buildManifest(devDist), plog("manifest done.")),
  );
  gulp.watch(
    ["LICENSE", "README.md"],
    gulp.series(outputMetaFiles(devDist), plog("metas done.")),
  );
};
