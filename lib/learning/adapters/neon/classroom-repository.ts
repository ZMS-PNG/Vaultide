import type {
  ClassroomRepository,
  ClassroomSnapshotMetadata,
  SaveClassroomSnapshotMetadata,
} from '../../ports/classroom-repository';
import { getLearningSql } from './client';

interface ClassroomRow {
  owner_id: string;
  classroom_id: string;
  revision: string | number;
  snapshot_blob_pathname: string;
  snapshot_blob_url: string;
  snapshot_sha256: string;
  snapshot_byte_size: number;
  scene_count: number;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapRow(row: ClassroomRow): ClassroomSnapshotMetadata {
  return {
    ownerId: row.owner_id,
    classroomId: row.classroom_id,
    revision: Number(row.revision),
    snapshotBlobPathname: row.snapshot_blob_pathname,
    snapshotBlobUrl: row.snapshot_blob_url,
    snapshotSha256: row.snapshot_sha256,
    snapshotByteSize: row.snapshot_byte_size,
    sceneCount: row.scene_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export class NeonClassroomRepository implements ClassroomRepository {
  async find(ownerId: string, classroomId: string): Promise<ClassroomSnapshotMetadata | null> {
    const rows = (await getLearningSql().query(
      `
        SELECT owner_id, classroom_id, revision, snapshot_blob_pathname, snapshot_blob_url,
               snapshot_sha256, snapshot_byte_size, scene_count, created_at, updated_at
        FROM learning_classrooms
        WHERE owner_id = $1 AND classroom_id = $2
      `,
      [ownerId, classroomId],
    )) as ClassroomRow[];
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async save(snapshot: SaveClassroomSnapshotMetadata): Promise<ClassroomSnapshotMetadata> {
    const rows = (await getLearningSql().query(
      `
        INSERT INTO learning_classrooms
          (owner_id, classroom_id, revision, snapshot_blob_pathname, snapshot_blob_url,
           snapshot_sha256, snapshot_byte_size, scene_count, created_at, updated_at)
        VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $8)
        ON CONFLICT (owner_id, classroom_id) DO UPDATE
        SET revision = learning_classrooms.revision + 1,
            snapshot_blob_pathname = EXCLUDED.snapshot_blob_pathname,
            snapshot_blob_url = EXCLUDED.snapshot_blob_url,
            snapshot_sha256 = EXCLUDED.snapshot_sha256,
            snapshot_byte_size = EXCLUDED.snapshot_byte_size,
            scene_count = EXCLUDED.scene_count,
            updated_at = EXCLUDED.updated_at
        RETURNING owner_id, classroom_id, revision, snapshot_blob_pathname, snapshot_blob_url,
                  snapshot_sha256, snapshot_byte_size, scene_count, created_at, updated_at
      `,
      [
        snapshot.ownerId,
        snapshot.classroomId,
        snapshot.snapshotBlobPathname,
        snapshot.snapshotBlobUrl,
        snapshot.snapshotSha256,
        snapshot.snapshotByteSize,
        snapshot.sceneCount,
        snapshot.now,
      ],
    )) as ClassroomRow[];
    const row = rows[0];
    if (!row) throw new Error('classroom_metadata_not_saved');
    return mapRow(row);
  }
}
