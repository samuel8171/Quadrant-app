import { describe, expect, it } from 'vitest'
import { parseData, serializeData } from '../src/main/dataCodec'
import { defaultData } from '../src/shared/defaults'

describe('dataCodec', () => {
  it('round-trips default data', () => {
    const data = defaultData()
    expect(parseData(serializeData(data))).toEqual(data)
  })

  it('rejects invalid payload', () => {
    expect(() => parseData('{"version":2}')).toThrow()
    expect(() => parseData('not json')).toThrow()
  })

  it('rejects payload without arrays', () => {
    expect(() => parseData('{"version":1}')).toThrow()
  })
})
