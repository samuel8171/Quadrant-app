import { describe, expect, it } from 'vitest'
import { defaultData } from '../src/shared/defaults'
import { validCloudData } from '../src/renderer/src/lib/cloudSync2'

describe('cloud sync validation', () => {
  it('accepts complete app data', () => expect(validCloudData(defaultData())).toBe(true))
  it('rejects incomplete data', () => expect(validCloudData({})).toBe(false))
})
