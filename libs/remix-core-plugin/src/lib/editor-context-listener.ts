'use strict'
import { Plugin } from '@remixproject/engine'
import { sourceMappingDecoder } from '@remix-project/remix-debug'
import { CompilerAbstract } from '@remix-project/remix-solidity'
import { Compiler } from '@remix-project/remix-solidity'


import { CompilationError, CompilationResult, CompilationSource, helper } from '@remix-project/remix-solidity-ts'


const profile = {
  name: 'contextualListener',
  methods: ['getBlockName', 'getLastNodeInLine', 'resolveImports', 'parseSource', 'getAST', 'nodesWithScope', 'nodesWithName', 'getNodes', 'compile', 'getNodeById', 'getLastCompilationResult', 'positionOfDefinition', 'definitionAtPosition', 'jumpToDefinition', 'referrencesAtPosition', 'nodesAtEditorPosition', 'referencesOf', 'getActiveHighlights', 'gasEstimation', 'declarationOf', 'jumpToPosition'],
  events: [],
  version: '0.0.1'
}

export function isDefinition(node: any) {
  return node.nodeType === 'ContractDefinition' ||
    node.nodeType === 'FunctionDefinition' ||
    node.nodeType === 'ModifierDefinition' ||
    node.nodeType === 'VariableDeclaration' ||
    node.nodeType === 'StructDefinition' ||
    node.nodeType === 'EventDefinition'
}

const SolidityParser = (window as any).SolidityParser = (window as any).SolidityParser || []

/*
  trigger contextChanged(nodes)
*/
export class EditorContextListener extends Plugin {
  _index: any
  _activeHighlights: Array<any>
  astWalker: any
  currentPosition: any
  currentFile: string
  nodes: Array<any>
  results: any
  estimationObj: any
  creationCost: any
  codeDepositCost: any
  contract: any
  activated: boolean
  lastCompilationResult: any
  lastAST: any
  compiler: any
  onAstFinished: (success: any, data: any, source: any, input: any, version: any) => Promise<void>

  constructor(astWalker) {
    super(profile)
    this.activated = false
    this._index = {
      Declarations: {},
      FlatReferences: {}
    }
    this._activeHighlights = []

    this.astWalker = astWalker
  }

  async onActivation() {
    this.on('editor', 'contentChanged', async () => {
      console.log('contentChanged')
      await this.getAST()
      await this.compile()
      this._stopHighlighting()
    })

    this.on('fileManager', 'currentFileChanged', async () => {
      await this.getAST()
      await this.compile()
      this._stopHighlighting()
    })

    this.on('solidity', 'loadingCompiler', async (url) => {
      console.log('loading compiler', url)
      this.compiler.loadVersion(true, url)
      this.compiler.event.register('compilerLoaded', async () => {
        console.log('compiler loaded')
      })
    })

    this.compiler = new Compiler((url, cb) => this.call('contentImport', 'resolveAndSave', url, undefined, false).then((result) => cb(null, result)).catch((error) => cb(error.message)))



    this.onAstFinished = async (success, data: CompilationResult, source: CompilationSource, input: any, version) => {
      console.log('compile success', success, data)
      this.call('editor', 'clearAnnotations')
      let noFatalErrors = true // ie warnings are ok
      const checkIfFatalError = (error: CompilationError) => {
        // Ignore warnings and the 'Deferred import' error as those are generated by us as a workaround
        const isValidError = (error.message && error.message.includes('Deferred import')) ? false : error.severity !== 'warning'
        if (isValidError) {
          console.log(error)
          noFatalErrors = false
        }
      }
      const result = new CompilerAbstract('soljson', data, source, input)



      if (data.error) checkIfFatalError(data.error)
      if (data.errors) data.errors.forEach((err) => checkIfFatalError(err))
      const allErrors = []
      if (data.errors) {
        for (const error of data.errors) {
          console.log('ERROR POS', error)
          let pos = helper.getPositionDetails(error.formattedMessage)
          console.log('ERROR POS', pos)
          const sources = result.getSourceCode().sources
          const source = sources[pos.file]
          const lineColumn = await this.call('offsetToLineColumnConverter', 'offsetToLineColumn',
            {
              start: error.sourceLocation.start,
              length: error.sourceLocation.end - error.sourceLocation.start
            },
            0,
            sources,
            null)
          console.log('lineColumn', lineColumn)
          allErrors.push({ error, lineColumn })
        }
        await this.call('editor', 'addErrorMarker', allErrors)
      } else {
        await this.call('editor', 'clearErrorMarkers', result.getSourceCode().sources)
      }
      

      if (!data.sources) return
      if (data.sources && Object.keys(data.sources).length === 0) return
      this.lastCompilationResult = new CompilerAbstract('soljson', data, source, input)

      this._stopHighlighting()
      this._index = {
        Declarations: {},
        FlatReferences: {}
      }
      this._buildIndex(data, source)
      this.emit('astFinished')
    }

    this.compiler.event.register('astFinished', this.onAstFinished)

    setInterval(async () => {

      //await this.compile()
    }, 1000)



    setInterval(async () => {
      return
      const compilationResult = this.lastCompilationResult // await this.call('compilerArtefacts', 'getLastCompilationResult')
      if (compilationResult && compilationResult.languageversion.indexOf('soljson') === 0) {

        let currentFile
        try {
          currentFile = await this.call('fileManager', 'file')
        } catch (error) {
          if (error.message !== 'Error: No such file or directory No file selected') throw error
        }
        this._highlightItems(
          await this.call('editor', 'getCursorPosition'),
          compilationResult,
          currentFile
        )
      }
    }, 1000)
  }

  async getLastCompilationResult() {
    return this.lastCompilationResult
  }

  async compile() {
    console.log('compile')
    try {
      const state = await this.call('solidity', 'getCompilerState')
      this.compiler.set('optimize', state.optimize)
      this.compiler.set('evmVersion', state.evmVersion)
      this.compiler.set('language', state.language)
      this.compiler.set('runs', state.runs)
      this.compiler.set('useFileConfiguration', state.useFileConfiguration)
      this.currentFile = await this.call('fileManager', 'file')
      if (!this.currentFile) return
      const content = await this.call('fileManager', 'readFile', this.currentFile)
      // console.log('compile', this.currentFile, content)
      const sources = { [this.currentFile]: { content } }
      this.compiler.compile(sources, this.currentFile)
    } catch (e) {
      console.log(e)
    }
  }

  async resolveImports(node, imported = {}) {
    if (node.nodeType === 'ImportDirective' && !imported[node.sourceUnit]) {
      console.log('IMPORTING', node)
      const importNode = await this.getNodeById(node.sourceUnit)
      imported[importNode.id] = importNode
      if (importNode.nodes) {
        for (const child of importNode.nodes) {
          imported = await this.resolveImports(child, imported)
        }
      }
    }
    console.log(imported)
    return imported
  }

  async getBlockName(position: any, text: string = null) {
    await this.getAST(text)
    const allowedTypes = ['SourceUnit', 'ContractDefinition', 'FunctionDefinition']

    const walkAst = (node) => {
      console.log(node)
      if (node.loc.start.line <= position.lineNumber && node.loc.end.line >= position.lineNumber) {
        const children = node.children || node.subNodes
        if (children && allowedTypes.indexOf(node.type) !== -1) {
          for (const child of children) {
            const result = walkAst(child)
            if (result) return result
          }
        }
        return node
      }
      return null
    }
    if (!this.lastAST) return
    return walkAst(this.lastAST)
  }

  async getAST(text: string = null) {
    this.currentFile = await this.call('fileManager', 'file')
    if (!this.currentFile) return
    const fileContent = text || await this.call('fileManager', 'readFile', this.currentFile)
    try {
      const ast = await this.parseSource(fileContent)
      this.lastAST = ast
      console.log('AST PARSE SUCCESS', ast)
    } catch (e) {
      console.log(e)
    }
    console.log('LAST PARSER AST', this.lastAST)
    return this.lastAST
  }

  async parseSource(text: string) {
    //console.log('PARSING', text)
    const ast = (SolidityParser as any).parse(text, { loc: true, range: true, tolerant: true })
    console.log('AST PARSE SUCCESS', ast)
    return ast
  }

  async getLastNodeInLine(ast: string) {
    let lastNode
    const checkLastNode = (node) => {
      if (lastNode && lastNode.range && lastNode.range[1]) {
        if (node.range[1] > lastNode.range[1]) {
          lastNode = node
        }
      } else {
        lastNode = node
      }
    }

    (SolidityParser as any).visit(ast, {
      MemberAccess: function (node) {
        checkLastNode(node)
      },
      Identifier: function (node) {
        checkLastNode(node)
      }
    })
    if (lastNode && lastNode.expression) {
      console.log('lastNode', lastNode.expression)
      return lastNode.expression
    }
    console.log('lastNode', lastNode)
    return lastNode
  }

  getActiveHighlights() {
    return [...this._activeHighlights]
  }

  declarationOf(node) {
    if (node && node.referencedDeclaration) {
      return this._index.FlatReferences[node.referencedDeclaration]
    } else {
      // console.log(this._index.FlatReferences)
    }
    return null
  }

  referencesOf(node: any) {
    const results = []
    const highlights = (id) => {
      if (this._index.Declarations && this._index.Declarations[id]) {
        const refs = this._index.Declarations[id]
        for (const ref in refs) {
          const node = refs[ref]
          results.push(node)
        }
      }
    }
    if (node && node.referencedDeclaration) {
      highlights(node.referencedDeclaration)
      const current = this._index.FlatReferences[node.referencedDeclaration]
      results.push(current)
    } else {
      highlights(node.id)
    }
    return results
  }

  async nodesAtEditorPosition(position: any, type = '') {
    const lastCompilationResult = this.lastCompilationResult // await this.call('compilerArtefacts', 'getLastCompilationResult')
    if (!lastCompilationResult) return false
    const urlFromPath = await this.call('fileManager', 'getUrlFromPath', this.currentFile)
    if (lastCompilationResult && lastCompilationResult.languageversion.indexOf('soljson') === 0 && lastCompilationResult.data) {
      const nodes = sourceMappingDecoder.nodesAtPosition(type, position, lastCompilationResult.data.sources[this.currentFile] || lastCompilationResult.data.sources[urlFromPath.file])
      return nodes
    }
    return []
  }

  async referrencesAtPosition(position: any) {
    const nodes = await this.nodesAtEditorPosition(position)
    if (nodes && nodes.length) {
      const node = nodes[nodes.length - 1]
      if (node) {
        return this.referencesOf(node)
      }
    }
  }

  async getNodeById(id: any) {
    for (const key in this._index.FlatReferences) {
      if (this._index.FlatReferences[key].id === id) {
        return this._index.FlatReferences[key]
      }
    }
  }

  async nodesWithScope(scope: any) {
    const nodes = []
    for (const node of Object.values(this._index.FlatReferences) as any[]) {
      if (node.scope === scope) nodes.push(node)
    }
    return nodes
  }

  async nodesWithName(name: string) {
    const nodes = []
    for (const node of Object.values(this._index.FlatReferences) as any[]) {
      if (node.name === name) nodes.push(node)
    }
    return nodes
  }

  async definitionAtPosition(position: any) {
    const nodes = await this.nodesAtEditorPosition(position)
    console.log('nodes at position', nodes)
    console.log(this._index.FlatReferences)
    let nodeDefinition: any
    let node: any
    if (nodes && nodes.length) {
      node = nodes[nodes.length - 1]
      nodeDefinition = node
      if (!isDefinition(node)) {
        nodeDefinition = await this.declarationOf(node) || node
      }
      if (node.nodeType === 'ImportDirective') {
        for (const key in this._index.FlatReferences) {
          if (this._index.FlatReferences[key].id === node.sourceUnit) {
            nodeDefinition = this._index.FlatReferences[key]
          }
        }
      }
      return nodeDefinition
    } else {
      return false
    }

  }

  async positionOfDefinition(node: any) {
    if (node) {
      if (node.src) {
        const position = sourceMappingDecoder.decode(node.src)
        if (position) {
          return position
        }
      }
    }
    return null
  }

  async jumpToDefinition(position: any) {
    const node = await this.definitionAtPosition(position)
    const sourcePosition = await this.positionOfDefinition(node)
    if (sourcePosition) {
      await this.jumpToPosition(sourcePosition)
    }
  }

  async getNodes() {
    return this._index.FlatReferences
  }

  /*
  * onClick jump to position of ast node in the editor
  */
  async jumpToPosition(position: any) {
    const jumpToLine = async (fileName: string, lineColumn: any) => {
      if (fileName !== await this.call('fileManager', 'file')) {
        console.log('jump to file', fileName)
        await this.call('contentImport', 'resolveAndSave', fileName, null, true)
        await this.call('fileManager', 'open', fileName)
      }
      if (lineColumn.start && lineColumn.start.line >= 0 && lineColumn.start.column >= 0) {
        this.call('editor', 'gotoLine', lineColumn.start.line, lineColumn.end.column + 1)
      }
    }
    const lastCompilationResult = this.lastCompilationResult // await this.call('compilerArtefacts', 'getLastCompilationResult')
    console.log(lastCompilationResult.getSourceCode().sources)
    console.log(position)
    if (lastCompilationResult && lastCompilationResult.languageversion.indexOf('soljson') === 0 && lastCompilationResult.data) {
      const lineColumn = await this.call('offsetToLineColumnConverter', 'offsetToLineColumn',
        position,
        position.file,
        lastCompilationResult.getSourceCode().sources,
        lastCompilationResult.getAsts())
      const filename = lastCompilationResult.getSourceName(position.file)
      // TODO: refactor with rendererAPI.errorClick
      console.log(filename, lineColumn)
      jumpToLine(filename, lineColumn)
    }
  }

  async _highlightItems(cursorPosition, compilationResult, file) {
    if (this.currentPosition === cursorPosition) return
    this._stopHighlighting()
    this.currentPosition = cursorPosition
    this.currentFile = file
    const urlFromPath = await this.call('fileManager', 'getUrlFromPath', this.currentFile)
    if (compilationResult && compilationResult.data && (compilationResult.data.sources[file] || compilationResult.data.sources[urlFromPath.file])) {
      const nodes = sourceMappingDecoder.nodesAtPosition(null, cursorPosition, compilationResult.data.sources[file] || compilationResult.data.sources[urlFromPath.file])
      this.nodes = nodes
      if (nodes && nodes.length && nodes[nodes.length - 1]) {
        await this._highlightExpressions(nodes[nodes.length - 1], compilationResult)
      }
      this.emit('contextChanged', nodes)
    }
  }

  _buildIndex(compilationResult, source) {
    if (compilationResult && compilationResult.sources) {
      const callback = (node) => {
        if (node && node.referencedDeclaration) {
          if (!this._index.Declarations[node.referencedDeclaration]) {
            this._index.Declarations[node.referencedDeclaration] = []
          }
          this._index.Declarations[node.referencedDeclaration].push(node)
        }
        this._index.FlatReferences[node.id] = node
      }
      for (const s in compilationResult.sources) {
        this.astWalker.walkFull(compilationResult.sources[s].ast, callback)
      }
    }
  }

  async _highlight(node, compilationResult) {
    if (!node) return
    const position = sourceMappingDecoder.decode(node.src)
    const fileTarget = compilationResult.getSourceName(position.file)
    const nodeFound = this._activeHighlights.find((el) => el.fileTarget === fileTarget && el.position.file === position.file && el.position.length === position.length && el.position.start === position.start)
    if (nodeFound) return // if the content is already highlighted, do nothing.

    await this._highlightInternal(position, node, compilationResult)
    if (compilationResult && compilationResult.languageversion.indexOf('soljson') === 0) {
      this._activeHighlights.push({ position, fileTarget, nodeId: node.id })
    }
  }

  async _highlightInternal(position, node, compilationResult) {
    if (node.nodeType === 'Block') return
    if (compilationResult && compilationResult.languageversion.indexOf('soljson') === 0) {
      let lineColumn = await this.call('offsetToLineColumnConverter', 'offsetToLineColumn', position, position.file, compilationResult.getSourceCode().sources, compilationResult.getAsts())
      if (node.nodes && node.nodes.length) {
        // If node has children, highlight the entire line. if not, just highlight the current source position of the node.
        lineColumn = {
          start: {
            line: lineColumn.start.line,
            column: 0
          },
          end: {
            line: lineColumn.start.line + 1,
            column: 0
          }
        }
      }
      const fileName = compilationResult.getSourceName(position.file)
      if (fileName) {
        return await this.call('editor', 'highlight', lineColumn, fileName, '', { focus: false })
      }
    }
    return null
  }

  async _highlightExpressions(node, compilationResult) {
    const highlights = async (id) => {
      if (this._index.Declarations && this._index.Declarations[id]) {
        const refs = this._index.Declarations[id]
        for (const ref in refs) {
          const node = refs[ref]
          await this._highlight(node, compilationResult)
        }
      }
    }
    if (node && node.referencedDeclaration) {
      await highlights(node.referencedDeclaration)
      const current = this._index.FlatReferences[node.referencedDeclaration]
      await this._highlight(current, compilationResult)
    } else {
      await highlights(node.id)
      await this._highlight(node, compilationResult)
    }

    this.results = compilationResult
  }

  _stopHighlighting() {
    this.call('editor', 'discardHighlight')
    this.emit('stopHighlighting')
    this._activeHighlights = []
  }

  gasEstimation(node) {
    this._loadContractInfos(node)
    let executionCost, codeDepositCost
    if (node.nodeType === 'FunctionDefinition') {
      const visibility = node.visibility
      if (node.kind !== 'constructor') {
        const fnName = node.name
        const fn = fnName + this._getInputParams(node)
        if (visibility === 'public' || visibility === 'external') {
          executionCost = this.estimationObj === null ? '-' : this.estimationObj.external[fn]
        } else if (visibility === 'private' || visibility === 'internal') {
          executionCost = this.estimationObj === null ? '-' : this.estimationObj.internal[fn]
        }
      } else {
        executionCost = this.creationCost
        codeDepositCost = this.codeDepositCost
      }
    } else {
      executionCost = '-'
    }
    return { executionCost, codeDepositCost }
  }

  _loadContractInfos(node) {
    const path = (this.nodes.length && this.nodes[0].absolutePath) || this.results.source.target
    for (const i in this.nodes) {
      if (this.nodes[i].id === node.scope) {
        const contract = this.nodes[i]
        this.contract = this.results.data.contracts[path][contract.name]
        if (contract) {
          this.estimationObj = this.contract.evm.gasEstimates
          this.creationCost = this.estimationObj === null ? '-' : this.estimationObj.creation.totalCost
          this.codeDepositCost = this.estimationObj === null ? '-' : this.estimationObj.creation.codeDepositCost
        }
      }
    }
  }



  _getInputParams(node) {
    const params = []
    const target = node.parameters
    // for (const i in node.children) {
    //   if (node.children[i].name === 'ParameterList') {
    //     target = node.children[i]
    //     break
    //   }
    // }
    if (target) {
      const children = target.parameters
      for (const j in children) {
        if (children[j].nodeType === 'VariableDeclaration') {
          params.push(children[j].typeDescriptions.typeString)
        }
      }
    }
    return '(' + params.toString() + ')'
  }
}
