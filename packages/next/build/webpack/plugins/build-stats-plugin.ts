import fs from 'fs'
import path from 'path'
// @ts-ignore no types package
import bfj from 'next/dist/compiled/bfj'
import { spans } from './profiling-plugin'
import { webpack } from 'next/dist/compiled/webpack/webpack'
import { tracer, traceAsyncFn } from '../../tracer'

const STATS_VERSION = 0

function reduceSize(stats: any) {
  const modules = new Map()
  stats.chunks = stats.chunks.map((chunk: any) => {
    const reducedChunk: any = {
      id: chunk.id,
      files: chunk.files,
      size: chunk.size,
    }

    for (const module of chunk.modules) {
      if (!module.identifier) {
        continue
      }

      const reducedModule: any = {
        type: module.type,
        moduleType: module.moduleType,
        size: module.size,
        identifier: module.identifier,
      }

      if (module.reasons) {
        for (const reason of module.reasons) {
          if (!reason.moduleIdentifier) {
            continue
          }

          if (!reducedModule.reasons) {
            reducedModule.reasons = []
          }

          reducedModule.reasons.push({
            moduleIdentifier: reason.moduleIdentifier,
          })
        }
      }
      // Identifier is part of the Map
      modules.set(module.id, reducedModule)

      if (!reducedChunk.modules) {
        reducedChunk.modules = []
      }

      reducedChunk.modules.push(module.id)
    }

    return reducedChunk
  })

  stats.modules = [...modules.entries()]

  for (const entrypointName in stats.entrypoints) {
    delete stats.entrypoints[entrypointName].assets
  }

  return stats
}

// This plugin creates a stats.json for a build when enabled
export default class BuildStatsPlugin {
  private distDir: string

  constructor(options: { distDir: string }) {
    this.distDir = options.distDir
  }

  apply(compiler: webpack.Compiler) {
    compiler.hooks.done.tapAsync(
      'NextJsBuildStats',
      async (stats, callback) => {
        tracer.withSpan(spans.get(compiler), async () => {
          try {
            const writeStatsSpan = tracer.startSpan('NextJsBuildStats')
            await traceAsyncFn(writeStatsSpan, () => {
              return new Promise((resolve, reject) => {
                const statsJson = reduceSize(
                  stats.toJson({
                    all: false,
                    cached: true,
                    reasons: true,
                    entrypoints: true,
                    chunks: true,
                    errors: false,
                    warnings: false,
                    maxModules: Infinity,
                    chunkModules: true,
                    // @ts-ignore this option exists
                    ids: true,
                  })
                )
                const fileStream = fs.createWriteStream(
                  path.join(this.distDir, 'next-stats.json')
                )
                const jsonStream = bfj.streamify({
                  version: STATS_VERSION,
                  stats: statsJson,
                })
                jsonStream.pipe(fileStream)
                jsonStream.on('error', reject)
                fileStream.on('error', reject)
                jsonStream.on('dataError', reject)
                fileStream.on('close', resolve)
              })
            })
            callback()
          } catch (err) {
            callback(err)
          }
        })
      }
    )
  }
}
