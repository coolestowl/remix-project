'use strict'

import { NightwatchBrowser } from 'nightwatch'
import init from '../helpers/init'
import sauce from './sauce'
import examples from '../examples/example-contracts'

const sources = [
  { 'Untitled.sol': { content: examples.ballot.content } }
]

module.exports = {
  before: function (browser: NightwatchBrowser, done: VoidFunction) {
    init(browser, done)
  },

  '@sources': function () {
    return sources
  },

  'Should compile using "compileWithParamaters" API': function (browser: NightwatchBrowser) {
    browser
      .addFile('test_jsCompile.js', { content: jsCompile })
      .executeScript('remix.exeCurrent()')
      .pause(5000)
      .journalChildIncludes('"languageversion": "0.6.8+commit.0bbfe453"')
      .click('*[data-id="terminalClearConsole"]')
  },

  'Should compile using "compileWithParamaters" API with optimization On': function (browser: NightwatchBrowser) {
    browser
      .addFile('test_jsCompileWithOptimization.js', { content: jsCompileWithOptimization })
      .executeScript('remix.exeCurrent()')
      .pause(10000)
      .journalChildIncludes('\\"optimizer\\":{\\"enabled\\":true,\\"runs\\":300}')
      .click('*[data-id="terminalClearConsole"]')
  },

  'Should compile using "compileWithParamaters" API with optimization off check default runs': function (browser: NightwatchBrowser) {
    browser
      .addFile('test_jsCompileWithOptimizationDefault.js', { content: jsCompileWithOptimizationDefault })
      .executeScript('remix.exeCurrent()')
      .pause(10000)
      .journalChildIncludes('\\"optimizer\\":{\\"enabled\\":false,\\"runs\\":200}')
      .click('*[data-id="terminalClearConsole"]')
  },

  'Should update the compiler configuration with "setCompilerConfig" API': function (browser: NightwatchBrowser) {
    browser
      .addFile('test_updateConfiguration.js', { content: updateConfiguration })
      .executeScript('remix.exeCurrent()')
      .pause(5000)
      .addFile('test_updateConfiguration.sol', { content: simpleContract })
      .verifyContracts(['StorageTestUpdateConfiguration'], { wait: 5000, version: '0.6.8+commit.0bbfe453' })
      .end()
  },

  tearDown: sauce
}

const simpleContract = `pragma solidity >=0.4.22 <0.8.1;

/**
* @title Storage
* @dev Store & retreive value in a variable
*/
contract StorageTestUpdateConfiguration {

  uint256 number;

  /**
   * @dev Store value in variable
   * @param num value to store
   */
  function store(uint256 num) public {
      number = num;
  }

  /**
   * @dev Return value 
   * @return value of 'number'
   */
  function retreive() public view returns (uint256){
      return number;
  }
}
          
          `

const jsCompile = `(async () => {
    
  try {
      const contract = {
          "storage.sol": {content : \`${simpleContract}\` }
      }
      console.log('compile')
      const params = {
          optimize: false,
          evmVersion: null,
          language: 'Solidity',
          version: '0.6.8+commit.0bbfe453'
      }
      const result = await remix.call('solidity', 'compileWithParameters', contract, params)
      console.log('result ', result)
  } catch (e) {
      console.log(e.message)
  }
})()`

const jsCompileWithOptimization = `(async () => {
  try {
      const contract = {
          "storage.sol": {content : \`${simpleContract}\` }
      }
      console.log('compile')
      const params = {
          optimize: true,
          runs: 300,
          evmVersion: null,
          language: 'Solidity',
          version: '0.6.8+commit.0bbfe453'
      }
      const result = await remix.call('solidity', 'compileWithParameters', contract, params)
      console.log('result ', result)
  } catch (e) {
      console.log(e.message)
  }
})()`

const jsCompileWithOptimizationDefault = `(async () => {
  try {
      const contract = {
          "storage.sol": {content : \`${simpleContract}\` }
      }
      console.log('compile')
      const params = {
          optimize: false,
      }
      const result = await remix.call('solidity', 'compileWithParameters', contract, params)
      console.log('result ', result)
  } catch (e) {
      console.log(e.message)   
  }
})()`

const updateConfiguration = `(async () => {
  try {    
      const params = {
          optimize: false,
          evmVersion: null,
          language: 'Solidity',
          version: '0.6.8+commit.0bbfe453'
      }
      await remix.call('solidity', 'setCompilerConfig', params)
  } catch (e) {
      console.log(e.message)   
  }
})()`
