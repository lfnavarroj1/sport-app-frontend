import { ServicePublicationsStore } from './service-publications.store';

const PUBLISHED = {
  id: '8e2885fb-ef5d-42ad-a02e-6ef5f97f377d',
  status: 'PUBLISHED' as const,
  version: 2,
  publishedAt: '2026-10-22T15:00:00Z',
  updatedAt: '2026-10-22T15:00:00Z',
};

describe('ServicePublicationsStore (HU019)', () => {
  it('recuerda la publicación confirmada y avisa que las listas cambiaron', () => {
    const store = new ServicePublicationsStore();

    expect(store.find(PUBLISHED.id)).toBeNull();
    expect(store.changes()).toBe(0);

    store.markPublished(PUBLISHED);

    expect(store.find(PUBLISHED.id)).toEqual(PUBLISHED);
    expect(store.changes()).toBe(1);
  });

  it('una nueva confirmación del mismo servicio reemplaza la anterior', () => {
    const store = new ServicePublicationsStore();
    store.markPublished(PUBLISHED);
    store.markPublished({ ...PUBLISHED, version: 3 });

    expect(store.find(PUBLISHED.id)?.version).toBe(3);
    expect(store.changes()).toBe(2);
  });
});
