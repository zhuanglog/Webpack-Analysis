let webpack = require('./zxpPack')
let options = require('./webpack.config')

let compiler = webpack(options)

compiler.run((err, stats) => {
  console.log(err)
  console.log(stats)
})