"""Placement of self-fitted building samples in the existing city-local frame.

C01/C02 fit their nominal plan to the source outline inside the model builder. The packaging
step bakes the source control points into a frame that differs from city-local only by an
explicit rotation + translation, so the renderer never applies a hidden reflection or a second fit.
Zero control-point residual only shows that the same source data is mapped consistently.
"""
import math

SELF_FITTED = {
    # C01 nave south edge = source vertices 0→7; the old render record w509641363 is the
    # church part at the south porch, so it must be replaced together with the parent outline.
    'C01': dict(osm='w509641361', replace=['osm:w509641361', 'osm:w509641363'], edge=(0, 7)),
    'C02': dict(osm='w352610288', replace=['osm:w352610288'], edge=(2, 1)),
}


def place_self_fitted(sid, sample, ring, project):
    cfg = SELF_FITTED[sid]
    px, pz = project(sample['origin'])
    a, b = ring[cfg['edge'][0]], ring[cfg['edge'][1]]
    theta = -math.atan2(b[1] - a[1], b[0] - a[0])
    co, si = math.cos(theta), math.sin(theta)
    sample['planFit']['target'] = [[(x - px) * co - (z - pz) * si, (x - px) * si + (z - pz) * co] for x, z in ring]
    return dict(sampleId=sid, sourceId='osm:' + cfg['osm'], replaceIds=cfg['replace'], position=[px, 0, pz],
                rotationY=theta, scale=[1, 1, 1], footprint=ring, precision='estimated',
                headingBasis='source south edge; photo orientation remains provisional')
