const CleanWebpackPlugin = require("clean-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const webpack = require("webpack");

const DIST = path.resolve(__dirname, "dist");

module.exports = {
  entry: {
    window: "./src/window/index.tsx",
    background: "./src/background/index.ts",
  },
  output: {
    filename: "[name].bundle.js",
    path: DIST,
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        enforce: "pre",
        use: [
          {
            loader: "tslint-loader",
            options: {
              emitErrors: true,
              failOnHint: true,
            },
          },
        ]
      },
      {
        test: /\.tsx?$/,
        use: "ts-loader",
        exclude: /node_modules/
      },
      {
        test: /\.scss$/,
        loader: 'style-loader!css-loader!sass-loader'
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        use: [
          'file-loader'
        ]
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin(["dist"]),
    new CopyWebpackPlugin([
      {from: "src/chrome/*", to: DIST, flatten: true},
    ]),
    new HtmlWebpackPlugin({
      template: "./src/template.html",
      chunks: ["window"],
      filename: "window.html",
    }),
    new HtmlWebpackPlugin({
      template: "./src/template.html",
      chunks: ["background"],
      filename: "background.html",
    }),
    new webpack.HotModuleReplacementPlugin(),
  ],
  performance: {
    maxEntrypointSize: 1000000,
    maxAssetSize: 1000000
  }
};
