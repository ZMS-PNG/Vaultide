export interface ClassroomSnapshotMetadata {
  ownerId: string;
  classroomId: string;
  revision: number;
  snapshotBlobPathname: string;
  snapshotBlobUrl: string;
  snapshotSha256: string;
  snapshotByteSize: number;
  sceneCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveClassroomSnapshotMetadata {
  ownerId: string;
  classroomId: string;
  snapshotBlobPathname: string;
  snapshotBlobUrl: string;
  snapshotSha256: string;
  snapshotByteSize: number;
  sceneCount: number;
  now: Date;
}

export interface ClassroomRepository {
  find(ownerId: string, classroomId: string): Promise<ClassroomSnapshotMetadata | null>;
  save(snapshot: SaveClassroomSnapshotMetadata): Promise<ClassroomSnapshotMetadata>;
}
