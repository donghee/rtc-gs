const rules = require("./webpack.rules");
const CopyPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require('webpack')
const path = require("path");

function isDebug() {
  return process.env.npm_lifecycle_event === "start";
}

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

rules.push({
  test: /\.(js|jsx)$/,
  exclude: /node_modules/,
  use: ["babel-loader"],
});

rules.push({
  test: require.resolve('janus-gateway'),
  loader: 'exports-loader',
  options: {
    exports: 'Janus',
  },
});

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "main.js",
    path: path.resolve(__dirname, "build"),
  },
  devServer: {
    static: {
      directory: path.join(__dirname, "build"),
    },
    historyApiFallback: true,
  },
  module: {
    rules,
  },
  resolve: {
    extensions: ["*", ".js", ".jsx"],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, "public", "index.html"),
      favicon: "./public/favicon.ico",
      filename: "./index.html",
      manifest: "./public/manifest.json",
    }),
    new webpack.ProvidePlugin({ adapter: ['webrtc-adapter', 'default'] })


    // new CopyPlugin({
    //   patterns: [
    //     {
    //       from: path.resolve(__dirname, "static"),
    //       //to: "static"
    //       to: path.resolve(
    //         __dirname,
    //         `.webpack/renderer${isDebug() ? "" : "/main_window"}`,
    //         "static"
    //       ),
    //     },
    //     {
    //       from: path.resolve(__dirname, "src"),
    //       //to: "src"
    //       to: path.resolve(
    //         __dirname,
    //         `.webpack/renderer${isDebug() ? "" : "/main_window"}`,
    //         "src"
    //       ),
    //     },
    //   ],
    // }),
    //
  ],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin()],
  },
};

