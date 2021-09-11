整体思路

![image](https://user-images.githubusercontent.com/30818926/131245066-bd0a48b9-dd90-416c-a73d-15e2dc60c34c.png)


会先执行webpack.js完成一个新的compiler对象，并把我们配置和默认的插件挂载到compiler对象身上，之后执行compiler的run方法，由这里开始就会送入入口文件到compilation对象，在compilation当中会把入口文件及其对应的一层层的依赖文件都送入NormalModule当中完成编译，打包过程会先把代码转成AST树，按照一定规则修改，然后再转成code，如果遇到非js文件就会调用loader转换；每个文件编译完成后就会按照依赖顺序放置于一个数组当中，合并成一个assest，由compiler的emit方法推送到指定目录当中
 
 一、node启动webpack.js文件，在这个文件主要引入 node_modules/webpack-cli/bin/cli.js，下面是引用过程解析cli地址的代码

```
	const path = require("path");
	const pkgPath = require.resolve(`${installedClis[0].package}/package.json`);
	// eslint-disable-next-line node/no-missing-require
	const pkg = require(pkgPath);
	// eslint-disable-next-line node/no-missing-require
	require(path.resolve(
		path.dirname(pkgPath),
		pkg.bin[installedClis[0].binName] 
	)); //这里就引用了node_modules/webpack-cli/bin/cli.js
```

 二、在cli.js文件当中的主要操作，根据命令行传入的参数options，通过调用node_modules/webpack/lib/webpack.js的方法实例化出一个complier
 

 三、在实例化compiler的过程当中，主要做了以下四件事情，简单可以写成这样
    

```
  // 01 调用Compiler方法初始化 compiler 对象
  let compiler = new Compiler(options.context)
  compiler.options = options

  // 02 初始化 NodeEnvironmentPlugin(让compiler具体文件读写能力)
  new NodeEnvironmentPlugin().apply(compiler)

  // 03 挂载所有 plugins 插件至 compiler 对象身上 
  if (options.plugins && Array.isArray(options.plugins)) {
    for (const plugin of options.plugins) {
      plugin.apply(compiler)
    }
  }

  // 04 挂载所有 webpack 内置的插件（入口）
  new WebpackOptionsApply().process(options, compiler);
```

 四、对于第三步骤当中的01方法--初始化一个compiler对象，主要工作是定义一个对象Compiler，并在对象内部挂载context（执行上下文），hooks（各种功能钩子）
    以及定义了run方法（最终编译的执行入口）

 五、对于第三步骤当中的02方法--为compiler添加读写能力，主要工作是通过NodeEnvironmentPlugin对象中的apply方法直接为compiler直接挂载上读写的函数，
    简单如下图所示


```
  apply(complier) {
    complier.inputFileSystem = fs
    complier.outputFileSystem = fs
  }
```

 六、对于第三步骤当中的03方法--挂载plugins到compiler对象上，主要工作是循环遍历传入的options当中的每一个plugin，调用plugin当中的apply方法为compiler
    挂载相应的函数
 
 七、对于第三步骤当中的04方法--挂载所有 webpack 内置的插件（入口），主要工作是执行WebpackOptionsApply当中的process方法，如下面所示，主要流程就是先调用 
     EntryOptionPlugin当中的apply方法为compiler.hooks.entryOption这个hook挂载对应的事件监听，然后通过call方法执行这些事件监听

```
  process(options, compiler) {
    new EntryOptionPlugin().apply(compiler)

    compiler.hooks.entryOption.call(options.context, options.entry)
  }
```

   在EntryOptionPlugin当中，主要是使用同步熔断钩子为entryOption挂载监听事件，可以看到执行监听事件时候回调函数执行了itemToPlugin方法并使用返回的apply
   属性来为compiler继续挂载钩子

```
class EntryOptionPlugin {
  apply(compiler) {
    compiler.hooks.entryOption.tap('EntryOptionPlugin', (context, entry) => {
      itemToPlugin(context, entry, "main").apply(compiler)
    })
  }
}
```
   itemToPlugin方法其实是新建了一个SingleEntryPlugin实例，其中的apply方法如下图所示，主要的是为compiler.hooks.make添加异步并行钩子，钩子的回调函数当中
   主要是执行了compilation类当中addEntry方法，其目的是为了就是在run的时候会通过调用这个make钩子给webpack添加入口文件，之后就一路生成chunk，内部的具体逻辑
   会在调用到的时候详细讲解，下面让我们回到主流程

```
  apply(compiler) {
    compiler.hooks.make.tapAsync('SingleEntryPlugin', (compilation, callback) => {
      const { context, entry, name } = this
      console.log("make 钩子监听执行了~~~~~~")
      compilation.addEntry(context, entry, name, callback)
    })
  }
```

 八、在定义完compiler之后，紧接着就执行了compiler的run方法，run方法的逻辑如下所示
     可以看到这里先执行了beforeRun钩子，在回调里执行了run这个钩子，在run的回调里拥有compile方法，并将onCompiled方法传入进去

```
  run(callback) {
    console.log('run 方法执行了~~~~')

    const finalCallback = function (err, stats) {
      callback(err, stats)
    }

    const onCompiled = (err, compilation) => {

      // 最终在这里将处理好的 chunk 写入到指定的文件然后输出至 dist 
      this.emitAssets(compilation, (err) => {
        let stats = new Stats(compilation)
        finalCallback(err, stats)
      })
    }

    this.hooks.beforeRun.callAsync(this, (err) => {
      this.hooks.run.callAsync(this, (err) => {
        this.compile(onCompiled)
      })
    })
  }
```

九、对于步骤八里的compile方法，简单代码如下所示，主要做了如下四件事情


```
  compile(callback) {
    // 01 提供模块打包的参数，主要是normalModuleFactory这个用于创建模块方法
    const params = this.newCompilationParams()
   
    //02 触发beforeCompile，并创建一个compilation
    this.hooks.beforeCompile.callAsync(params, (err) => {
      this.hooks.compile.call(params)
      const compilation = this.newCompilation(params)
      //03 触发make钩子，提供addEntry入口
      this.hooks.make.callAsync(compilation, (err) => {
        // console.log('make钩子监听触发了~~~~~')
        // callback(err, compilation)

        // 04 在这里我们开始处理 chunk 
        compilation.seal((err) => {
          this.hooks.afterCompile.callAsync(compilation, (err) => {
            callback(err, compilation)
          })
        })
      })
    })
  }
```
十、对于步骤九当中的01--提供compilation的参数，主要参数是就是normalModuleFactory对象生成的一个实例，其代码如下所示

```
class NormalModuleFactory {
  create(data) {
    return new NormalModule(data)
  }
}
```
其中的create方法当中的NormalModule主要目的是提供了一个build方法，用来转换该模块对应文件，doBuild方法从文件中读取到将来需要被加载的module内容，
在其回调函数中，我们会通过传入的parser将当前模块内容构建成AST语法树，在语法树中完成对应操作，例如对应文件的loader处理，文件的绝对地址定位，将requeire
替换成内部自己定义的__webpack_require__等等，同时这部分信息会被压入到dependencies数组当中方便递归调用，最后再通过generator将AST语法树转成代码

```
  build(compilation, callback) {

    this.doBuild(compilation, (err) => {
      this._ast = this.parser.parse(this._source)

      // 这里的 _ast 就是当前 module 的语法树，我们可以对它进行修改，最后再将 ast 转回成 code 代码 
      traverse(this._ast, {
        CallExpression: (nodePath) => {
          let node = nodePath.node

          // 定位 require 所在的节点
          if (node.callee.name === 'require') {
            // 获取原始请求路径
            let modulePath = node.arguments[0].value  // './title'  
            // 取出当前被加载的模块名称
            let moduleName = modulePath.split(path.posix.sep).pop()  // title
            // [当前我们的打包器只处理 js ]
            let extName = moduleName.indexOf('.') == -1 ? '.js' : ''
            moduleName += extName  // title.js
            // 【最终我们想要读取当前js里的内容】 所以我们需要个绝对路径
            let depResource = path.posix.join(path.posix.dirname(this.resource), moduleName)
            // 【将当前模块的 id 定义OK】
            let depModuleId = './' + path.posix.relative(this.context, depResource)  // ./src/title.js

            // 记录当前被依赖模块的信息，方便后面递归加载
            this.dependencies.push({
              name: this.name, // TODO: 将来需要修改 
              context: this.context,
              rawRequest: moduleName,
              moduleId: depModuleId,
              resource: depResource
            })

            // 替换内容
            node.callee.name = '__webpack_require__'
            node.arguments = [types.stringLiteral(depModuleId)]
          }
        }
      })

      // 上述的操作是利用ast 按要求做了代码修改，下面的内容就是利用 .... 将修改后的 ast 转回成 code 
      let { code } = generator(this._ast)
      this._source = code
      callback(err)
    })
  }
```

十一、对于步骤九当中的02方法--触发beforeCompile，并创建一个compilation，在compilation内部主要是封装了addEntry（为当前地址的文件编译创建一个模块）
     和seal（生成chunk）两个方法

十二、对于步骤九当中的03方法--触发make钩子，提供addEntry入口，make钩子是我们在步骤七当中挂载上去的，其主要操作是执行了compilation的addEntry方法，
     可以看到其主要是通过调用_addModuleChain方法，在其内部调用了createModule方法，其目的就是为了创建一个属于当前地址的模块
   
```
  addEntry(context, entry, name, callback) {
    this._addModuleChain(context, entry, name, (err, module) => {
      callback(err, module)
    })
  }

  _addModuleChain(context, entry, name, callback) {
    this.createModule({
      parser,
      name: name,
      context: context,
      rawRequest: entry,
      resource: path.posix.join(context, entry),
      moduleId: './' + path.posix.relative(context, path.posix.join(context, entry))
    }, (entryModule) => {
      this.entries.push(entryModule)
    }, callback)
  }
```
   

   在createModule内部通过normalModuleFactory的create方法先实例化出一个NormalModule，使用buildModule方法来完成当前模块的编译，
   其中buildModule当中主要的就是通过NormalModule当中的build方法来编译当前模块，build的具体思路在步骤十当中已经给出，这里不在赘述。

   使用doAddEntry将目前的入口模块添加到this.entries当中，定义afterBuild方法主要是为了当前模块编译完成之后继续编译依赖文件，afterBuild之中
   主要使用了processDependencies方法


```
  createModule(data, doAddEntry, callback) {
    let module = normalModuleFactory.create(data)

    const afterBuild = (err, module) => {
      // 在 afterBuild 当中我们就需要判断一下，当前次module 加载完成之后是否需要处理依赖加载
      if (module.dependencies.length > 0) {
        // 当前逻辑就表示module 有需要依赖加载的模块，因此我们可以再单独定义一个方法来实现
        this.processDependencies(module, (err) => {
          callback(err, module)
        })
      } else {
        callback(err, module)
      }
    }

    this.buildModule(module, afterBuild)

    // 当我们完成了本次的 build 操作之后将 module 进行保存
    doAddEntry && doAddEntry(module)
    this.modules.push(module)
  }

```

    processDependencies的核心功能就是实现一个被依赖模块的递归加载，按照顺序调用createModule来创建一个模块， 使用neo-async 
    可以让所有的被依赖的模块都加载完成之后再执行 callback

    这一步完成之后从入口文件开始所有被依赖的模块就都被加载到compilation的entries和modules当中了


```
  processDependencies(module, callback) {

    let dependencies = module.dependencies

    async.forEach(dependencies, (dependency, done) => {
      this.createModule({
        parser,
        name: dependency.name,
        context: dependency.context,
        rawRequest: dependency.rawRequest,
        moduleId: dependency.moduleId,
        resource: dependency.resource
      }, null, done)
    }, callback)
  }
```


十三、对于步骤九当中的04方法--开始处理chunk，注意这里是在make钩子的回调函数当中执行的，主要是执行了compilation当中的seal方法，经过刚才build操作之后，
     当前所有的入口模块都被存放在了 compilation 对象的 entries 数组里，这一步的主要目的找到它的所有依赖，将它们的源代码放在一起，之后再做合并。
     通过遍历this.entries，将当前所有的模块都一一放入chunks当中，然后通过执行createChunkAssets来得到各文件处理过后的代码，主要是通过ejs这个模块结合
     自定义的模板文件进行编译，然后输出到compilation 对象的assets当中。

```
  seal(callback) {
    this.hooks.seal.call()
    this.hooks.beforeChunks.call()

    for (const entryModule of this.entries) {
      // 核心： 创建模块加载已有模块的内容，同时记录模块信息 
      const chunk = new Chunk(entryModule)

      // 保存 chunk 信息
      this.chunks.push(chunk)

      // 给 chunk 属性赋值 
      chunk.modules = this.modules.filter(module => module.name === chunk.name)

    }

    // chunk 流程梳理之后就进入到 chunk 代码处理环节（模板文件 + 模块中的源代码==》chunk.js)
    this.hooks.afterChunks.call(this.chunks)

    // 生成代码内容
    this.createChunkAssets()

    callback()
  }
```

十四、可以关注到步骤九里compile函数是传了一个onCompiled函数进来，在上面一步执行完之后我们就会执行这个回调，可以看到这里主要是执行了emitAssets函数
     主要目的就是把刚刚写入到compilation这个对象中的assets一个接着一个地写入到指定的地址当中，this.options.output.path也就是我们在webpack.config
     文件里定义的输出路径。
     这一步之后主体的打包流程就结束了。

  
```
this.compile(onCompiled)
```

```
    const onCompiled = (err, compilation) => {

      // 最终在这里将处理好的 chunk 写入到指定的文件然后输出至 dist 
      this.emitAssets(compilation, (err) => {
        let stats = new Stats(compilation)
        finalCallback(err, stats)
      })
    }
```


```
  emitAssets(compilation, callback) {
    // 当前需要做的核心： 01 创建dist  02 在目录创建完成之后执行文件的写操作

    // 01 定义一个工具方法用于执行文件的生成操作
    const emitFlies = (err) => {
      const assets = compilation.assets
      let outputPath = this.options.output.path

      for (let file in assets) {
        let source = assets[file]
        let targetPath = path.posix.join(outputPath, file)
        this.outputFileSystem.writeFileSync(targetPath, source, 'utf8')
      }

      callback(err)
    }

    // 创建目录之后启动文件写入
    this.hooks.emit.callAsync(compilation, (err) => {
      mkdirp.sync(this.options.output.path)
      emitFlies()
    })

  }
```



