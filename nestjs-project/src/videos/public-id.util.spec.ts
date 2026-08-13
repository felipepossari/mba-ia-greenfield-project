import { generatePublicId } from './public-id.util';

describe('generatePublicId', () => {
  it('should generate a 12-character hex string', () => {
    const id = generatePublicId();
    expect(id).toMatch(/^[a-f0-9]{12}$/);
  });

  it('should generate unpredictable identifiers', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generatePublicId());
    }
    expect(ids.size).toBe(100);
  });

  it('should have high entropy (different on each call)', () => {
    const id1 = generatePublicId();
    const id2 = generatePublicId();
    expect(id1).not.toBe(id2);
  });
});
