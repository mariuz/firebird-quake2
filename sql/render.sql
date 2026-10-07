-- render.sql – r_bsp.c, r_surf.c and r_alias.c as a query.
--
-- FRAME_FACES_FAST is the frame: for the cluster the eye is in, every face of
-- every leaf whose cluster is in its PVS is marked once (DISTINCT, like
-- Quake's visframe marking) into VIS_FACES with its plane and bounding sphere
-- copied in, so each frame is a single scan of that table with the back-face
-- and frustum tests as expressions, no join. Brush-model entities (doors,
-- plats) are a second, smaller cursor: the visible entities' faces at their
-- own origin and rotation. FRAME_FACES projects every vertex in SQL as well.
--
-- FRAME_ENTS lists the alias models and sprites in the PVS: the browser
-- transforms their vertices (an MD2 frame is ~200 vertices; shipping them
-- through SQL every frame would be the one thing slower than drawing them).
--
-- FRAME_ALL gathers everything a frame needs into one result set – faces,
-- entities, light styles, sounds, effects, brush-model poses – so the page
-- makes one round trip to the engine per frame instead of six.

SET TERM ^ ;

CREATE OR ALTER PROCEDURE view_setup
RETURNS (ex DOUBLE PRECISION, ey DOUBLE PRECISION, ez DOUBLE PRECISION,
         fx DOUBLE PRECISION, fy DOUBLE PRECISION, fz DOUBLE PRECISION,
         rx DOUBLE PRECISION, ry DOUBLE PRECISION, rz DOUBLE PRECISION,
         ux DOUBLE PRECISION, uy DOUBLE PRECISION, uz DOUBLE PRECISION,
         w INTEGER, h INTEGER, scale_ DOUBLE PRECISION, nearz DOUBLE PRECISION,
         kx DOUBLE PRECISION, ky DOUBLE PRECISION, pvs VARCHAR(2048) CHARACTER SET ASCII, cluster INTEGER, leaf INTEGER)
AS
DECLARE yaw DOUBLE PRECISION; DECLARE pitch DOUBLE PRECISION; DECLARE fov DOUBLE PRECISION;
DECLARE sy DOUBLE PRECISION; DECLARE cy DOUBLE PRECISION; DECLARE sp DOUBLE PRECISION; DECLARE cp DOUBLE PRECISION;
DECLARE stepz DOUBLE PRECISION; DECLARE punch DOUBLE PRECISION; DECLARE dead SMALLINT;
BEGIN
  SELECT e.x, e.y, e.z + p.view_ofs, e.yaw, p.pitch + p.punchangle, p.stepz, e.deadflag
    FROM player p JOIN ents e ON e.id = p.ent_id WHERE p.id = 1 INTO ex, ey, ez, yaw, pitch, stepz, dead;
  ez = ez - COALESCE(stepz, 0);
  SELECT c.w, c.h, c.fov, c.near_z FROM viewcfg c WHERE c.id = 1 INTO w, h, fov, nearz;
  sy = SIN(yaw * 0.0174532925e0); cy = COS(yaw * 0.0174532925e0);
  sp = SIN(pitch * 0.0174532925e0); cp = COS(pitch * 0.0174532925e0);
  fx = cp * cy; fy = cp * sy; fz = -sp;
  rx = sy; ry = -cy; rz = 0;
  ux = sp * cy; uy = sp * sy; uz = cp;
  IF (dead = 1) THEN
  BEGIN
    -- the dead lie on their side: roll the view 40 degrees
    sp = rx; cp = ry;
    rx = sp * 0.766e0 + ux * 0.643e0; ry = cp * 0.766e0 + uy * 0.643e0; rz = rz * 0.766e0 + uz * 0.643e0;
    ux = -sp * 0.643e0 + ux * 0.766e0; uy = -cp * 0.643e0 + uy * 0.766e0; uz = uz * 0.766e0;
  END
  scale_ = (w / 2e0) / TAN(fov * 0.5e0 * 0.0174532925e0);
  kx = (w / 2e0) / scale_;
  ky = (h / 2e0) / scale_;
  -- the eye's leaf: the one found for this position last frame, else a walk of the tree
  SELECT c.lv_leaf FROM viewcfg c WHERE c.id = 1 AND c.lv_ex = :ex AND c.lv_ey = :ey AND c.lv_ez = :ez INTO leaf;
  IF (leaf IS NULL) THEN leaf = point_leaf(ex, ey, ez);
  SELECT l.pvs, l.cluster FROM leaves l WHERE l.id = :leaf INTO pvs, cluster;
  IF (pvs IS NULL) THEN pvs = '';
  IF (cluster IS NULL) THEN cluster = -1;
  SUSPEND;
END^

SET TERM ; ^

-- the marked world faces (PSQL has no arrays; Quake has visframe): every face
-- of every leaf in the PVS of the cluster the eye is in, kept until the eye
-- moves to another cluster, with the plane and bounding sphere copied in so
-- the frame is a scan of this table alone
CREATE TABLE vis_faces (
  face   INTEGER NOT NULL PRIMARY KEY,
  nx DOUBLE PRECISION NOT NULL, ny DOUBLE PRECISION NOT NULL, nz DOUBLE PRECISION NOT NULL, dist DOUBLE PRECISION NOT NULL,
  cx DOUBLE PRECISION NOT NULL, cy DOUBLE PRECISION NOT NULL, cz DOUBLE PRECISION NOT NULL, radius DOUBLE PRECISION NOT NULL
);

-- the faces that survive this frame's back-face and frustum tests (FRAME_FACES),
-- with the entity's origin and rotation (m00..m22: world = o + M · v)
CREATE GLOBAL TEMPORARY TABLE sel_faces (
  face   INTEGER NOT NULL,
  ent_id INTEGER NOT NULL,
  ox DOUBLE PRECISION NOT NULL, oy DOUBLE PRECISION NOT NULL, oz DOUBLE PRECISION NOT NULL,
  m00 DOUBLE PRECISION DEFAULT 1 NOT NULL, m01 DOUBLE PRECISION DEFAULT 0 NOT NULL, m02 DOUBLE PRECISION DEFAULT 0 NOT NULL,
  m10 DOUBLE PRECISION DEFAULT 0 NOT NULL, m11 DOUBLE PRECISION DEFAULT 1 NOT NULL, m12 DOUBLE PRECISION DEFAULT 0 NOT NULL,
  m20 DOUBLE PRECISION DEFAULT 0 NOT NULL, m21 DOUBLE PRECISION DEFAULT 0 NOT NULL, m22 DOUBLE PRECISION DEFAULT 1 NOT NULL,
  PRIMARY KEY (ent_id, face)
) ON COMMIT DELETE ROWS;

SET TERM ^ ;

-- Is any of an entity's clusters in the PVS? (none at all, e.g. a fan whose probes fell in solid: yes)
CREATE OR ALTER FUNCTION clusters_visible (pvs VARCHAR(2048) CHARACTER SET ASCII, c1 INTEGER, c2 INTEGER, c3 INTEGER)
RETURNS SMALLINT
AS
BEGIN
  IF (pvs IS NULL OR pvs = '') THEN RETURN 1;
  IF ((c1 IS NULL OR c1 < 0) AND c2 IS NULL AND c3 IS NULL) THEN RETURN 1;
  IF (pvs_visible(pvs, c1) = 1) THEN RETURN 1;
  IF (c2 IS NOT NULL AND pvs_visible(pvs, c2) = 1) THEN RETURN 1;
  IF (c3 IS NOT NULL AND pvs_visible(pvs, c3) = 1) THEN RETURN 1;
  RETURN 0;
END^

-- mark_faces: R_MarkLeaves, once per view cluster: every face of every leaf
-- in the PVS goes into VIS_FACES (kept until the eye moves to another cluster)
CREATE OR ALTER PROCEDURE mark_faces (pvs VARCHAR(2048) CHARACTER SET ASCII, vcluster INTEGER)
AS
DECLARE cur INTEGER; DECLARE world INTEGER;
DECLARE bminx DOUBLE PRECISION; DECLARE bminy DOUBLE PRECISION; DECLARE bminz DOUBLE PRECISION;
DECLARE bmaxx DOUBLE PRECISION; DECLARE bmaxy DOUBLE PRECISION; DECLARE bmaxz DOUBLE PRECISION;
BEGIN
  SELECT c.vis_cluster FROM viewcfg c WHERE c.id = 1 INTO cur;
  IF (cur IS NOT DISTINCT FROM vcluster) THEN EXIT;
  SELECT g.world_model FROM game g WHERE g.id = 1 INTO world;
  -- the cluster's box: a face with all of it behind its plane cannot face an eye anywhere in it
  SELECT MIN(l.minx), MIN(l.miny), MIN(l.minz), MAX(l.maxx), MAX(l.maxy), MAX(l.maxz) FROM leaves l WHERE l.cluster = :vcluster
    INTO bminx, bminy, bminz, bmaxx, bmaxy, bmaxz;
  IF (bminx IS NULL) THEN BEGIN bminx = -1e9; bminy = -1e9; bminz = -1e9; bmaxx = 1e9; bmaxy = 1e9; bmaxz = 1e9; END
  DELETE FROM vis_faces;
  INSERT INTO vis_faces (face, nx, ny, nz, dist, cx, cy, cz, radius)
  SELECT f.id, f.nx, f.ny, f.nz, f.dist, f.cx, f.cy, f.cz, f.radius
    FROM faces f
   WHERE f.model_id = :world AND BIN_AND(f.flags, 128) = 0
     AND IIF(f.nx > 0, f.nx * :bmaxx, f.nx * :bminx) + IIF(f.ny > 0, f.ny * :bmaxy, f.ny * :bminy) + IIF(f.nz > 0, f.nz * :bmaxz, f.nz * :bminz) - f.dist > 0
     AND f.id IN (SELECT lf.face
                    FROM leaves l
                    JOIN leaffaces lf ON lf.id >= l.first_lf AND lf.id < l.first_lf + l.num_lf
                   WHERE l.cluster >= 0 AND l.num_lf > 0
                     AND (:pvs = '' OR BIN_AND(POSITION(SUBSTRING(:pvs FROM BIN_SHR(l.cluster, 2) + 1 FOR 1), '0123456789abcdef') - 1, BIN_SHL(1, BIN_AND(l.cluster, 3))) <> 0));
  UPDATE viewcfg c SET c.vis_cluster = :vcluster, c.world_lst = NULL WHERE c.id = 1;
END^

-- FRAME_FACES: the same faces, projected vertex by vertex in SQL.
CREATE OR ALTER PROCEDURE frame_faces
RETURNS (face INTEGER, seq INTEGER, vf DOUBLE PRECISION, vr DOUBLE PRECISION, vu DOUBLE PRECISION,
         sx DOUBLE PRECISION, sy DOUBLE PRECISION, s DOUBLE PRECISION, t DOUBLE PRECISION, ent_id INTEGER)
AS
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE fx DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION;
DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE w INTEGER; DECLARE h INTEGER; DECLARE sc DOUBLE PRECISION; DECLARE nearz DOUBLE PRECISION;
DECLARE kx DOUBLE PRECISION; DECLARE ky DOUBLE PRECISION; DECLARE pvs VARCHAR(2048) CHARACTER SET ASCII; DECLARE vcl INTEGER; DECLARE vleaf INTEGER;
DECLARE hw DOUBLE PRECISION; DECLARE hh DOUBLE PRECISION; DECLARE qx DOUBLE PRECISION; DECLARE qy DOUBLE PRECISION; DECLARE world INTEGER;
DECLARE vseq INTEGER; DECLARE eid INTEGER; DECLARE fid INTEGER; DECLARE cur INTEGER; DECLARE curent INTEGER;
DECLARE emid INTEGER; DECLARE ox DOUBLE PRECISION; DECLARE oy DOUBLE PRECISION; DECLARE oz DOUBLE PRECISION;
DECLARE c2 INTEGER; DECLARE c3 INTEGER; DECLARE cl INTEGER; DECLARE ep DOUBLE PRECISION; DECLARE eyaw DOUBLE PRECISION; DECLARE er DOUBLE PRECISION;
DECLARE m00 DOUBLE PRECISION; DECLARE m01 DOUBLE PRECISION; DECLARE m02 DOUBLE PRECISION;
DECLARE m10 DOUBLE PRECISION; DECLARE m11 DOUBLE PRECISION; DECLARE m12 DOUBLE PRECISION;
DECLARE m20 DOUBLE PRECISION; DECLARE m21 DOUBLE PRECISION; DECLARE m22 DOUBLE PRECISION;
BEGIN
  EXECUTE PROCEDURE view_setup RETURNING_VALUES ex, ey, ez, fx, fy, fz, rx, ry, rz, ux, uy, uz, w, h, sc, nearz, kx, ky, pvs, vcl, vleaf;
  hw = w / 2e0; hh = h / 2e0;
  qx = SQRT(1 + kx * kx); qy = SQRT(1 + ky * ky);
  EXECUTE PROCEDURE mark_faces(pvs, vcl);

  -- the faces that face the eye and whose sphere is in the frustum
  DELETE FROM sel_faces;
  INSERT INTO sel_faces (face, ent_id, ox, oy, oz)
  SELECT v.face, 0, 0, 0, 0
    FROM vis_faces v
   WHERE v.nx * :ex + v.ny * :ey + v.nz * :ez - v.dist > 0
     AND (v.cx - :ex) * :fx + (v.cy - :ey) * :fy + (v.cz - :ez) * :fz + v.radius >= :nearz
     AND ABS((v.cx - :ex) * :rx + (v.cy - :ey) * :ry + (v.cz - :ez) * :rz)
         <= ((v.cx - :ex) * :fx + (v.cy - :ey) * :fy + (v.cz - :ez) * :fz) * :kx + v.radius * :qx
     AND ABS((v.cx - :ex) * :ux + (v.cy - :ey) * :uy + (v.cz - :ez) * :uz)
         <= ((v.cx - :ex) * :fx + (v.cy - :ey) * :fy + (v.cz - :ez) * :fz) * :ky + v.radius * :qy;
  SELECT g.world_model FROM game g WHERE g.id = 1 INTO world;
  FOR SELECT e.id, e.model_id, e.x, e.y, e.z, e.cluster, e.cl2, e.cl3, e.pitch, e.yaw, e.roll
        FROM ents e
       WHERE e.mkind = 'B' AND e.model_id <> :world AND e.solid <> 1
        INTO eid, emid, ox, oy, oz, cl, c2, c3, ep, eyaw, er
  DO
  BEGIN
    IF (clusters_visible(pvs, cl, c2, c3) = 0) THEN CONTINUE;
    IF (ep = 0 AND eyaw = 0 AND er = 0) THEN
      INSERT INTO sel_faces (face, ent_id, ox, oy, oz)
      SELECT f.id, :eid, :ox, :oy, :oz FROM faces f
       WHERE f.model_id = :emid AND BIN_AND(f.flags, 128) = 0
         AND f.nx * (:ex - :ox) + f.ny * (:ey - :oy) + f.nz * (:ez - :oz) - f.dist > 0
         AND (f.cx + :ox - :ex) * :fx + (f.cy + :oy - :ey) * :fy + (f.cz + :oz - :ez) * :fz + f.radius >= :nearz
         AND ABS((f.cx + :ox - :ex) * :rx + (f.cy + :oy - :ey) * :ry + (f.cz + :oz - :ez) * :rz)
             <= ((f.cx + :ox - :ex) * :fx + (f.cy + :oy - :ey) * :fy + (f.cz + :oz - :ez) * :fz) * :kx + f.radius * :qx
         AND ABS((f.cx + :ox - :ex) * :ux + (f.cy + :oy - :ey) * :uy + (f.cz + :oz - :ez) * :uz)
             <= ((f.cx + :ox - :ex) * :fx + (f.cy + :oy - :ey) * :fy + (f.cz + :oz - :ez) * :fz) * :ky + f.radius * :qy;
    ELSE
    BEGIN
      EXECUTE PROCEDURE angle_matrix(ep, eyaw, er) RETURNING_VALUES m00, m01, m02, m10, m11, m12, m20, m21, m22;
      INSERT INTO sel_faces (face, ent_id, ox, oy, oz, m00, m01, m02, m10, m11, m12, m20, m21, m22)
      SELECT f.id, :eid, :ox, :oy, :oz, :m00, :m01, :m02, :m10, :m11, :m12, :m20, :m21, :m22 FROM faces f WHERE f.model_id = :emid AND BIN_AND(f.flags, 128) = 0;
    END
  END

  -- one cursor over the selected faces' vertices: the rotation, the view transform and the
  -- projection are in the select list, evaluated by the engine rather than as PSQL statements.
  -- The (face, seq) key walks each face's vertices in order. Vertices behind the near plane
  -- project to NULL; the painter clips those edges in view space.
  cur = -1; curent = -1;
  FOR SELECT v.ent_id, f.id, fv.seq,
             (v.m00 * fv.x + v.m01 * fv.y + v.m02 * fv.z + v.ox - :ex) * :fx + (v.m10 * fv.x + v.m11 * fv.y + v.m12 * fv.z + v.oy - :ey) * :fy + (v.m20 * fv.x + v.m21 * fv.y + v.m22 * fv.z + v.oz - :ez) * :fz,
             (v.m00 * fv.x + v.m01 * fv.y + v.m02 * fv.z + v.ox - :ex) * :rx + (v.m10 * fv.x + v.m11 * fv.y + v.m12 * fv.z + v.oy - :ey) * :ry + (v.m20 * fv.x + v.m21 * fv.y + v.m22 * fv.z + v.oz - :ez) * :rz,
             (v.m00 * fv.x + v.m01 * fv.y + v.m02 * fv.z + v.ox - :ex) * :ux + (v.m10 * fv.x + v.m11 * fv.y + v.m12 * fv.z + v.oy - :ey) * :uy + (v.m20 * fv.x + v.m21 * fv.y + v.m22 * fv.z + v.oz - :ez) * :uz,
             fv.x * f.sx + fv.y * f.sy + fv.z * f.sz + f.soff,
             fv.x * f.tx + fv.y * f.ty + fv.z * f.tz + f.toff
        FROM sel_faces v
        JOIN faces f ON f.id = v.face
        JOIN face_verts fv ON fv.face = f.id
        INTO eid, fid, vseq, vf, vr, vu, s, t
  DO
  BEGIN
    IF (fid <> cur OR eid <> curent OR vseq = 0) THEN
    BEGIN
      cur = fid; curent = eid; face = fid; ent_id = eid;
    END
    seq = vseq;
    IF (vf >= nearz) THEN
    BEGIN
      sx = hw + vr * sc / vf; sy = hh - vu * sc / vf;
    END
    ELSE
    BEGIN
      sx = NULL; sy = NULL;
    END
    SUSPEND;
  END
END^

SET TERM ; ^

-- the light style values of this frame: 'a'..'z' → 0..2
CREATE OR ALTER VIEW frame_lightstyles AS
SELECT l.style,
       (ASCII_VAL(SUBSTRING(l.pattern FROM 1 + MOD(CAST(FLOOR(g.time_ * 10) AS INTEGER), CHAR_LENGTH(l.pattern)) FOR 1)) - 97) / 12.5e0 AS value_
  FROM lightstyles l CROSS JOIN game g
 WHERE g.id = 1;

SET TERM ^ ;

-- FRAME_ALL: the frame as one result set, so the page makes one round trip to the
-- engine per frame. SQL decides what is visible (PVS, back faces, frustum); the painter transforms
-- the vertices it already holds from the BSP. The visible faces travel as one ',' separated list
-- per model (LIST() is cheap; a row costs about 6 µs): the world's from VIS_FACES, each brush-model
-- entity's in the PVS at its origin (rotated models skip the tests: the painter clips them). kind:
--   1 faces (i2 ent, d1..3 origin, lst the face ids)
--   8 projected vertex, mode 1 only (i1 face, i2 seq, i3 ent, d1..7 vf vr vu sx sy s t)
--   2 alias model or sprite (i1 id, i2 model, i3 frame, i4 skin, i5 effects, d1..6 pose, d7 alpha, d8 renderfx, s kind)
--   3 light styles that animate or that the map has switched (lst as style:letter pairs; the rest hold their resting letter)
--   4 sound after last_sound (i1 id, i2 ent, i3 chan, d1 vol, d2 attn, d3..5 at, s name)
--   5 effect after last_fx (i1 id, i2 kind, i3 n, d1..6 at/to)
--   6 brush-model pose (i1 ent, i2 frame, d1..3 angles)
--   7 the looped speakers that are on (lst their ids), when want_speakers = 1
CREATE OR ALTER PROCEDURE frame_all (mode SMALLINT, last_sound INTEGER, last_fx INTEGER, want_speakers SMALLINT)
RETURNS (kind SMALLINT, i1 INTEGER, i2 INTEGER, i3 INTEGER, i4 INTEGER, i5 INTEGER,
         d1 DOUBLE PRECISION, d2 DOUBLE PRECISION, d3 DOUBLE PRECISION, d4 DOUBLE PRECISION, d5 DOUBLE PRECISION,
         d6 DOUBLE PRECISION, d7 DOUBLE PRECISION, d8 DOUBLE PRECISION, s VARCHAR(64),
         lst BLOB SUB_TYPE TEXT CHARACTER SET ASCII)
AS
DECLARE ex DOUBLE PRECISION; DECLARE ey DOUBLE PRECISION; DECLARE ez DOUBLE PRECISION;
DECLARE fx DOUBLE PRECISION; DECLARE fy DOUBLE PRECISION; DECLARE fz DOUBLE PRECISION;
DECLARE rx DOUBLE PRECISION; DECLARE ry DOUBLE PRECISION; DECLARE rz DOUBLE PRECISION;
DECLARE ux DOUBLE PRECISION; DECLARE uy DOUBLE PRECISION; DECLARE uz DOUBLE PRECISION;
DECLARE w INTEGER; DECLARE h INTEGER; DECLARE sc DOUBLE PRECISION; DECLARE nearz DOUBLE PRECISION;
DECLARE kx DOUBLE PRECISION; DECLARE ky DOUBLE PRECISION; DECLARE pvs VARCHAR(2048) CHARACTER SET ASCII; DECLARE vcl INTEGER; DECLARE vleaf INTEGER;
DECLARE qx DOUBLE PRECISION; DECLARE qy DOUBLE PRECISION; DECLARE world INTEGER; DECLARE pe INTEGER;
DECLARE eid INTEGER; DECLARE emid INTEGER; DECLARE cl INTEGER; DECLARE c2 INTEGER; DECLARE c3 INTEGER; DECLARE rot SMALLINT;
DECLARE vis SMALLINT; DECLARE vis_cl INTEGER;
DECLARE alpha SMALLINT; DECLARE k CHAR(1); DECLARE rfx INTEGER;
DECLARE ef DOUBLE PRECISION; DECLARE er DOUBLE PRECISION; DECLARE eu DOUBLE PRECISION;
DECLARE nrx DOUBLE PRECISION; DECLARE nry DOUBLE PRECISION; DECLARE nrz DOUBLE PRECISION; DECLARE enr DOUBLE PRECISION;
DECLARE nlx DOUBLE PRECISION; DECLARE nly DOUBLE PRECISION; DECLARE nlz DOUBLE PRECISION; DECLARE enl DOUBLE PRECISION;
DECLARE ntx DOUBLE PRECISION; DECLARE nty DOUBLE PRECISION; DECLARE ntz DOUBLE PRECISION; DECLARE ent DOUBLE PRECISION;
DECLARE nbx DOUBLE PRECISION; DECLARE nby DOUBLE PRECISION; DECLARE nbz DOUBLE PRECISION; DECLARE enb DOUBLE PRECISION;
DECLARE stamp INTEGER; DECLARE held SMALLINT; DECLARE fl_stamp INTEGER; DECLARE pose_ok SMALLINT;
DECLARE bcx DOUBLE PRECISION; DECLARE bcy DOUBLE PRECISION; DECLARE bcz DOUBLE PRECISION; DECLARE brad DOUBLE PRECISION; DECLARE bcf DOUBLE PRECISION;
BEGIN
  SELECT g.world_model FROM game g WHERE g.id = 1 INTO world;
  pe = player_ent();
  EXECUTE PROCEDURE view_setup RETURNING_VALUES ex, ey, ez, fx, fy, fz, rx, ry, rz, ux, uy, uz, w, h, sc, nearz, kx, ky, pvs, vcl, vleaf;
  qx = SQRT(1 + kx * kx); qy = SQRT(1 + ky * ky);
  -- (c - e)·f = c·f - e·f: the eye's part is a constant of the frame, not of the row
  ef = ex * fx + ey * fy + ez * fz; er = ex * rx + ey * ry + ez * rz; eu = ex * ux + ey * uy + ez * uz;
  -- the frustum's side planes (unnormalised: kx·f ∓ r, ky·f ∓ u; a sphere is in when c·n - e·n + R·|n| >= 0
  -- with |n| = qx or qy), one-sided tests that fail at the first plane the sphere is outside
  nrx = kx * fx - rx; nry = kx * fy - ry; nrz = kx * fz - rz; enr = ex * nrx + ey * nry + ez * nrz;
  nlx = kx * fx + rx; nly = kx * fy + ry; nlz = kx * fz + rz; enl = ex * nlx + ey * nly + ez * nlz;
  ntx = ky * fx - ux; nty = ky * fy - uy; ntz = ky * fz - uz; ent = ex * ntx + ey * nty + ez * ntz;
  nbx = ky * fx + ux; nby = ky * fy + uy; nbz = ky * fz + uz; enb = ex * nbx + ey * nby + ez * nbz;
  IF (mode = 1) THEN
  BEGIN
    kind = 8;
    FOR SELECT f.face, f.seq, f.ent_id, f.vf, f.vr, f.vu, f.sx, f.sy, f.s, f.t FROM frame_faces f INTO i1, i2, i3, d1, d2, d3, d4, d5, d6, d7 DO SUSPEND;
    i3 = NULL; d4 = NULL; d5 = NULL; d6 = NULL; d7 = NULL;
  END
  ELSE
  BEGIN
    EXECUTE PROCEDURE mark_faces(pvs, vcl);
    kind = 1; i2 = 0; d1 = 0; d2 = 0; d3 = 0;
    -- the world's list holds while the eye holds still: the last one is kept on viewcfg
    SELECT c.view_stamp, IIF(c.lv_ex = :ex AND c.lv_ey = :ey AND c.lv_ez = :ez
       AND c.lv_fx = :fx AND c.lv_fy = :fy AND c.lv_fz = :fz AND c.lv_ux = :ux AND c.lv_uy = :uy AND c.lv_uz = :uz, c.world_lst, NULL)
      FROM viewcfg c WHERE c.id = 1 INTO stamp, lst;
    held = IIF(lst IS NULL, 0, 1);
    IF (lst IS NULL) THEN
    BEGIN
      stamp = stamp + 1;
      SELECT LIST(v.face, ',')
        FROM vis_faces v
       WHERE v.nx * :ex + v.ny * :ey + v.nz * :ez - v.dist > 0
         AND v.cx * :nrx + v.cy * :nry + v.cz * :nrz - :enr + v.radius * :qx >= 0
         AND v.cx * :nlx + v.cy * :nly + v.cz * :nlz - :enl + v.radius * :qx >= 0
         AND v.cx * :ntx + v.cy * :nty + v.cz * :ntz - :ent + v.radius * :qy >= 0
         AND v.cx * :nbx + v.cy * :nby + v.cz * :nbz - :enb + v.radius * :qy >= 0
         AND v.cx * :fx + v.cy * :fy + v.cz * :fz - :ef + v.radius >= :nearz
        INTO lst;
      UPDATE viewcfg c SET c.lv_ex = :ex, c.lv_ey = :ey, c.lv_ez = :ez, c.lv_fx = :fx, c.lv_fy = :fy, c.lv_fz = :fz, c.lv_ux = :ux, c.lv_uy = :uy, c.lv_uz = :uz, c.lv_leaf = :vleaf, c.world_lst = :lst, c.view_stamp = :stamp WHERE c.id = 1;
    END
    IF (lst IS NOT NULL) THEN SUSPEND;

    -- the brush-model entities in the PVS. Whether a model's clusters are in the PVS is decided
    -- once per view cluster and kept on the row until the model is relinked.
    FOR SELECT e.id, e.model_id, e.x, e.y, e.z, e.cluster, e.cl2, e.cl3, IIF(e.pitch <> 0 OR e.yaw <> 0 OR e.roll <> 0, 1, 0), e.vis_cl, e.vis,
               IIF(e.fl_stamp = :stamp AND e.fl_x = e.x AND e.fl_y = e.y AND e.fl_z = e.z AND e.fl_p = e.pitch AND e.fl_yaw = e.yaw AND e.fl_r = e.roll, 1, 0), e.faces_lst,
               e.x + (e.minx + e.maxx) / 2, e.y + (e.miny + e.maxy) / 2, e.z + (e.minz + e.maxz) / 2, (e.maxx - e.minx + e.maxy - e.miny + e.maxz - e.minz) / 2
          FROM ents e
         WHERE e.mkind = 'B' AND e.model_id <> :world AND e.solid <> 1
          INTO eid, emid, d1, d2, d3, cl, c2, c3, rot, vis_cl, vis, pose_ok, lst, bcx, bcy, bcz, brad
    DO
    BEGIN
      IF (vis_cl IS DISTINCT FROM vcl OR vis IS NULL) THEN
      BEGIN
        vis = clusters_visible(pvs, cl, c2, c3);
        UPDATE ents e SET e.vis_cl = :vcl, e.vis = :vis WHERE e.id = :eid;
      END
      IF (vis = 0) THEN CONTINUE;
      i2 = eid;
      -- the list made for this view and this pose (the view held, the model did not move): reuse it
      IF (pose_ok = 1) THEN
      BEGIN
        IF (lst IS NOT NULL) THEN SUSPEND;
        CONTINUE;
      END
      -- the whole model against the frustum first (a rotated one: a sphere about its origin wide enough for any angle)
      IF (rot = 1) THEN BEGIN brad = brad + ABS(bcx - d1) + ABS(bcy - d2) + ABS(bcz - d3); bcx = d1; bcy = d2; bcz = d3; END
      bcf = bcx * fx + bcy * fy + bcz * fz - ef;
      IF (bcf + brad < nearz OR bcx * nrx + bcy * nry + bcz * nrz - enr + brad * qx < 0 OR bcx * nlx + bcy * nly + bcz * nlz - enl + brad * qx < 0
          OR bcx * ntx + bcy * nty + bcz * ntz - ent + brad * qy < 0 OR bcx * nbx + bcy * nby + bcz * nbz - enb + brad * qy < 0) THEN lst = NULL;
      ELSE
      BEGIN
      -- the eye in the model's space (e - o) against the frame's planes
      d4 = (ex - d1) * fx + (ey - d2) * fy + (ez - d3) * fz;
      d5 = (ex - d1) * nrx + (ey - d2) * nry + (ez - d3) * nrz; d6 = (ex - d1) * nlx + (ey - d2) * nly + (ez - d3) * nlz;
      d7 = (ex - d1) * ntx + (ey - d2) * nty + (ez - d3) * ntz; d8 = (ex - d1) * nbx + (ey - d2) * nby + (ez - d3) * nbz;
      SELECT LIST(f.id, ',')
        FROM faces f
       WHERE f.model_id = :emid AND BIN_AND(f.flags, 128) = 0
         AND (:rot = 1 OR (
             f.nx * (:ex - :d1) + f.ny * (:ey - :d2) + f.nz * (:ez - :d3) - f.dist > 0
         AND f.cx * :nrx + f.cy * :nry + f.cz * :nrz - :d5 + f.radius * :qx >= 0
         AND f.cx * :nlx + f.cy * :nly + f.cz * :nlz - :d6 + f.radius * :qx >= 0
         AND f.cx * :ntx + f.cy * :nty + f.cz * :ntz - :d7 + f.radius * :qy >= 0
         AND f.cx * :nbx + f.cy * :nby + f.cz * :nbz - :d8 + f.radius * :qy >= 0
         AND f.cx * :fx + f.cy * :fy + f.cz * :fz - :d4 + f.radius >= :nearz))
        INTO lst;
      d4 = NULL; d5 = NULL; d6 = NULL; d7 = NULL; d8 = NULL;
      END
      -- a held view will ask for the same list next frame: keep it (a turning view would only pay for the write)
      IF (held = 1) THEN
        UPDATE ents e SET e.faces_lst = :lst, e.fl_stamp = :stamp, e.fl_x = e.x, e.fl_y = e.y, e.fl_z = e.z, e.fl_p = e.pitch, e.fl_yaw = e.yaw, e.fl_r = e.roll WHERE e.id = :eid;
      IF (lst IS NOT NULL) THEN SUSPEND;
    END
    lst = NULL;
  END

  -- the alias models and sprites in the frustum and the PVS, with their pose. Both tests are
  -- expressions of the cursor (the PVS one on the eye's leaf row, joined in), so only the
  -- entities drawn reach PSQL; the sphere is the model's radius plus a margin for any monster's box.
  kind = 2;
  FOR SELECT e.id, e.model_id, e.frame, e.skin, e.effects, e.x, e.y, e.z, e.pitch, e.yaw, e.roll, e.alpha, e.renderfx, e.mkind
        FROM ents e CROSS JOIN leaves l
       WHERE l.id = :vleaf AND e.mkind IN ('M', 'S') AND e.id <> :pe
         AND e.x * :fx + e.y * :fy + e.z * :fz - :ef + e.mradius + 64 >= :nearz
         AND e.x * :nrx + e.y * :nry + e.z * :nrz - :enr + (e.mradius + 64) * :qx >= 0
         AND e.x * :nlx + e.y * :nly + e.z * :nlz - :enl + (e.mradius + 64) * :qx >= 0
         AND e.x * :ntx + e.y * :nty + e.z * :ntz - :ent + (e.mradius + 64) * :qy >= 0
         AND e.x * :nbx + e.y * :nby + e.z * :nbz - :enb + (e.mradius + 64) * :qy >= 0
         AND (l.pvs = ''
              OR ((e.cluster IS NULL OR e.cluster < 0) AND e.cl2 IS NULL AND e.cl3 IS NULL)
              OR (e.cluster >= 0 AND BIN_AND(POSITION(SUBSTRING(l.pvs FROM BIN_SHR(e.cluster, 2) + 1 FOR 1), '0123456789abcdef') - 1, BIN_SHL(1, BIN_AND(e.cluster, 3))) <> 0)
              OR (e.cl2 IS NOT NULL AND BIN_AND(POSITION(SUBSTRING(l.pvs FROM BIN_SHR(e.cl2, 2) + 1 FOR 1), '0123456789abcdef') - 1, BIN_SHL(1, BIN_AND(e.cl2, 3))) <> 0)
              OR (e.cl3 IS NOT NULL AND BIN_AND(POSITION(SUBSTRING(l.pvs FROM BIN_SHR(e.cl3, 2) + 1 FOR 1), '0123456789abcdef') - 1, BIN_SHL(1, BIN_AND(e.cl3, 3))) <> 0))
        INTO i1, i2, i3, i4, i5, d1, d2, d3, d4, d5, d6, alpha, rfx, k
  DO
  BEGIN
    d7 = alpha; d8 = rfx; s = k;
    SUSPEND;
  END
  kind = 3; i1 = NULL; i2 = NULL; i3 = NULL; i4 = NULL; i5 = NULL; d1 = NULL; d2 = NULL; d3 = NULL; d4 = NULL; d5 = NULL; d6 = NULL; d7 = NULL; d8 = NULL; s = NULL;
  -- only the styles that animate or that the map has switched since it started (the page holds the resting
  -- letters): style:letter pairs, 'a' dark … 'm' normal … 'z' double
  SELECT LIST(s.style || ':' || SUBSTRING(s.pattern FROM 1 + MOD(CAST(FLOOR(g.time_ * 10) AS INTEGER), CHAR_LENGTH(s.pattern)) FOR 1), ',')
    FROM lightstyles s CROSS JOIN game g WHERE g.id = 1 AND (CHAR_LENGTH(s.pattern) > 1 OR s.pattern IS DISTINCT FROM s.base_pattern) INTO lst;
  SUSPEND;
  lst = NULL;
  kind = 4;
  FOR SELECT se.id, se.ent_id, se.chan, se.vol, se.attn, se.x, se.y, se.z, se.snd FROM sound_events se WHERE se.id > :last_sound ORDER BY se.id
        INTO i1, i2, i3, d1, d2, d3, d4, d5, s DO SUSPEND;
  kind = 5; s = NULL;
  FOR SELECT fe.id, fe.kind, fe.n, fe.x, fe.y, fe.z, fe.x2, fe.y2, fe.z2 FROM fx_events fe WHERE fe.id > :last_fx ORDER BY fe.id
        INTO i1, i2, i3, d1, d2, d3, d4, d5, d6 DO SUSPEND;
  kind = 6; i3 = NULL; d4 = NULL; d5 = NULL; d6 = NULL;
  FOR SELECT e.id, e.frame, e.pitch, e.yaw, e.roll FROM ents e
       WHERE e.mkind = 'B' AND (e.frame <> 0 OR e.pitch <> 0 OR e.yaw <> 0 OR e.roll <> 0) INTO i1, i2, d1, d2, d3 DO SUSPEND;
  IF (want_speakers = 1) THEN
  BEGIN
    kind = 7; i1 = NULL; i2 = NULL; d1 = NULL; d2 = NULL; d3 = NULL;
    SELECT LIST(e.id, ',') FROM ents e WHERE e.classname = 'target_speaker' AND e.sounds = 1 INTO lst;
    SUSPEND;
  END
END^

-- FRAME_FACES_FAST: the faces to draw, one row each (FRAME_ALL's lists split), for scripts and the console
CREATE OR ALTER PROCEDURE frame_faces_fast
RETURNS (face INTEGER, ent_id INTEGER, ox DOUBLE PRECISION, oy DOUBLE PRECISION, oz DOUBLE PRECISION)
AS
DECLARE lst BLOB SUB_TYPE TEXT CHARACTER SET ASCII; DECLARE buf VARCHAR(32000) CHARACTER SET ASCII;
DECLARE p INTEGER; DECLARE q INTEGER; DECLARE n INTEGER; DECLARE off INTEGER;
BEGIN
  FOR SELECT r.i2, r.d1, r.d2, r.d3, r.lst FROM frame_all(0, 2147483647, 2147483647, 0) r WHERE r.kind = 1 INTO ent_id, ox, oy, oz, lst
  DO
  BEGIN
    n = CHAR_LENGTH(lst); off = 1;
    WHILE (off <= n) DO
    BEGIN
      -- 32000 characters at a time, cut at a ','
      buf = SUBSTRING(lst FROM off FOR 32000);
      IF (off + 32000 <= n) THEN
      BEGIN
        q = CHAR_LENGTH(buf);
        WHILE (q > 0 AND SUBSTRING(buf FROM q FOR 1) <> ',') DO q = q - 1;
        buf = SUBSTRING(buf FROM 1 FOR q);
      END
      off = off + CHAR_LENGTH(buf);
      p = 1;
      WHILE (p <= CHAR_LENGTH(buf)) DO
      BEGIN
        q = POSITION(',', buf, p);
        IF (q = 0) THEN q = CHAR_LENGTH(buf) + 1;
        face = CAST(SUBSTRING(buf FROM p FOR q - p) AS INTEGER);
        SUSPEND;
        p = q + 1;
      END
    END
  END
END^

-- FRAME_ENTS: the alias models and sprites to draw, with their pose (the entity rows of FRAME_ALL)
CREATE OR ALTER PROCEDURE frame_ents
RETURNS (id INTEGER, model_id INTEGER, frame INTEGER, skin INTEGER,
         x DOUBLE PRECISION, y DOUBLE PRECISION, z DOUBLE PRECISION,
         pitch DOUBLE PRECISION, yaw DOUBLE PRECISION, roll DOUBLE PRECISION,
         effects INTEGER, alpha SMALLINT, kind CHAR(1), renderfx INTEGER)
AS
BEGIN
  FOR SELECT r.i1, r.i2, r.i3, r.i4, r.d1, r.d2, r.d3, r.d4, r.d5, r.d6, r.i5, r.d7, r.s, r.d8
        FROM frame_all(0, 2147483647, 2147483647, 0) r WHERE r.kind = 2
        INTO id, model_id, frame, skin, x, y, z, pitch, yaw, roll, effects, alpha, kind, renderfx DO SUSPEND;
END^

SET TERM ; ^
