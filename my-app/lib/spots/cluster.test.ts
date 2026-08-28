import { CLUSTER_CELL_PX, clusterByScreen, isGrouped } from './cluster';

const pin = (id: string, x: number, y: number) => ({ id, at: { x, y } });

describe('clusterByScreen', () => {
  it('leaves well-separated pins alone', () => {
    const clusters = clusterByScreen([pin('a', 10, 10), pin('b', 300, 300)]);
    expect(clusters).toHaveLength(2);
    expect(clusters.every(c => !isGrouped(c))).toBe(true);
  });

  it('groups pins that would visually overlap', () => {
    const clusters = clusterByScreen([pin('a', 10, 10), pin('b', 14, 12)]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map(m => m.id)).toEqual(['a', 'b']);
    expect(isGrouped(clusters[0])).toBe(true);
  });

  it('places a group at its members centroid, not the grid corner', () => {
    const [cluster] = clusterByScreen([pin('a', 10, 20), pin('b', 30, 40)]);
    expect(cluster.at).toEqual({ x: 20, y: 30 });
  });

  it('takes its id from the lead member so it is stable across renders', () => {
    // Grid-position ids would change the moment the camera moved a pixel,
    // remounting every marker.
    const [cluster] = clusterByScreen([pin('lead', 10, 10), pin('other', 12, 12)]);
    expect(cluster.id).toBe('lead');
  });

  it('preserves input ranking in the output order', () => {
    const clusters = clusterByScreen([
      pin('first', 500, 500),
      pin('second', 10, 10),
      pin('third', 250, 250),
    ]);
    expect(clusters.map(c => c.id)).toEqual(['first', 'second', 'third']);
  });

  it('leads each group with its highest-ranked member', () => {
    const clusters = clusterByScreen([pin('closest', 10, 10), pin('further', 12, 12)]);
    expect(clusters[0].members[0].id).toBe('closest');
  });

  it('separates pins in adjacent cells', () => {
    const clusters = clusterByScreen([pin('a', 1, 1), pin('b', CLUSTER_CELL_PX + 1, 1)]);
    expect(clusters).toHaveLength(2);
  });

  it('handles negative coordinates — pins scrolled off the top-left', () => {
    const clusters = clusterByScreen([pin('a', -10, -10), pin('b', -12, -12)]);
    expect(clusters).toHaveLength(1);
  });

  it('is deterministic', () => {
    const input = [pin('a', 10, 10), pin('b', 12, 12), pin('c', 400, 400)];
    expect(clusterByScreen(input)).toEqual(clusterByScreen(input));
  });

  it('handles an empty list', () => {
    expect(clusterByScreen([])).toEqual([]);
  });

  it('honours a custom cell size', () => {
    expect(clusterByScreen([pin('a', 0, 0), pin('b', 50, 0)], 200)).toHaveLength(1);
    expect(clusterByScreen([pin('a', 0, 0), pin('b', 50, 0)], 10)).toHaveLength(2);
  });
});
