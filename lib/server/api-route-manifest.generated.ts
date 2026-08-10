export type ConsolidatedApiRouteParameter = {
  readonly name: string;
  readonly catchAll: boolean;
};

export type ConsolidatedApiRoute = {
  readonly pattern: RegExp;
  readonly params: readonly ConsolidatedApiRouteParameter[];
  readonly load: () => Promise<unknown>;
};

// Generated from lib/server/api-routes. Keep route URLs stable while bundling
// all API handlers behind one Vercel Function on the Hobby plan.
export const consolidatedApiRoutes: readonly ConsolidatedApiRoute[] = [
  {
    pattern: /^access-code\/status$/,
    params: [],
    load: () => import('@/lib/server/api-routes/access-code/status/handler'),
  },
  {
    pattern: /^access-code\/verify$/,
    params: [],
    load: () => import('@/lib/server/api-routes/access-code/verify/handler'),
  },
  {
    pattern: /^agent\/edit$/,
    params: [],
    load: () => import('@/lib/server/api-routes/agent/edit/handler'),
  },
  {
    pattern: /^azure-voices$/,
    params: [],
    load: () => import('@/lib/server/api-routes/azure-voices/handler'),
  },
  {
    pattern: /^chat$/,
    params: [],
    load: () => import('@/lib/server/api-routes/chat/handler'),
  },
  {
    pattern: /^chat\/pi$/,
    params: [],
    load: () => import('@/lib/server/api-routes/chat/pi/handler'),
  },
  {
    pattern: /^classroom$/,
    params: [],
    load: () => import('@/lib/server/api-routes/classroom/handler'),
  },
  {
    pattern: /^classroom-media\/([^/]+)\/(.+)$/,
    params: [
      { name: 'classroomId', catchAll: false },
      { name: 'path', catchAll: true },
    ],
    load: () => import('@/lib/server/api-routes/classroom-media/[classroomId]/[...path]/handler'),
  },
  {
    pattern: /^comfyui-workflows$/,
    params: [],
    load: () => import('@/lib/server/api-routes/comfyui-workflows/handler'),
  },
  {
    pattern: /^export-video\/capability$/,
    params: [],
    load: () => import('@/lib/server/api-routes/export-video/capability/handler'),
  },
  {
    pattern: /^export-video\/render$/,
    params: [],
    load: () => import('@/lib/server/api-routes/export-video/render/handler'),
  },
  {
    pattern: /^export-video\/render\/([^/]+)$/,
    params: [{ name: 'jobId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/export-video/render/[jobId]/handler'),
  },
  {
    pattern: /^export-video\/render\/([^/]+)\/download$/,
    params: [{ name: 'jobId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/export-video/render/[jobId]/download/handler'),
  },
  {
    pattern: /^extract-document$/,
    params: [],
    load: () => import('@/lib/server/api-routes/extract-document/handler'),
  },
  {
    pattern: /^generate-classroom$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate-classroom/handler'),
  },
  {
    pattern: /^generate-classroom\/([^/]+)$/,
    params: [{ name: 'jobId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/generate-classroom/[jobId]/handler'),
  },
  {
    pattern: /^generate\/agent-profiles$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/agent-profiles/handler'),
  },
  {
    pattern: /^generate\/image$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/image/handler'),
  },
  {
    pattern: /^generate\/scene-actions$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/scene-actions/handler'),
  },
  {
    pattern: /^generate\/scene-content$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/scene-content/handler'),
  },
  {
    pattern: /^generate\/scene-outlines-stream$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/scene-outlines-stream/handler'),
  },
  {
    pattern: /^generate\/tts$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/tts/handler'),
  },
  {
    pattern: /^generate\/video$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/video/handler'),
  },
  {
    pattern: /^generate\/voice$/,
    params: [],
    load: () => import('@/lib/server/api-routes/generate/voice/handler'),
  },
  {
    pattern: /^health$/,
    params: [],
    load: () => import('@/lib/server/api-routes/health/handler'),
  },
  {
    pattern: /^internal\/course-generation\/worker$/,
    params: [],
    load: () => import('@/lib/server/api-routes/internal/course-generation/worker/handler'),
  },
  {
    pattern: /^parse-pdf$/,
    params: [],
    load: () => import('@/lib/server/api-routes/parse-pdf/handler'),
  },
  {
    pattern: /^pbl\/chat$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/chat/handler'),
  },
  {
    pattern: /^pbl\/v2\/evaluate$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/v2/evaluate/handler'),
  },
  {
    pattern: /^pbl\/v2\/instructor$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/v2/instructor/handler'),
  },
  {
    pattern: /^pbl\/v2\/open-task$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/v2/open-task/handler'),
  },
  {
    pattern: /^pbl\/v2\/simulator$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/v2/simulator/handler'),
  },
  {
    pattern: /^pbl\/v2\/task\/update$/,
    params: [],
    load: () => import('@/lib/server/api-routes/pbl/v2/task/update/handler'),
  },
  {
    pattern: /^provider\/probe-models$/,
    params: [],
    load: () => import('@/lib/server/api-routes/provider/probe-models/handler'),
  },
  {
    pattern: /^proxy-media$/,
    params: [],
    load: () => import('@/lib/server/api-routes/proxy-media/handler'),
  },
  {
    pattern: /^quiz-grade$/,
    params: [],
    load: () => import('@/lib/server/api-routes/quiz-grade/handler'),
  },
  {
    pattern: /^server-providers$/,
    params: [],
    load: () => import('@/lib/server/api-routes/server-providers/handler'),
  },
  {
    pattern: /^transcription$/,
    params: [],
    load: () => import('@/lib/server/api-routes/transcription/handler'),
  },
  {
    pattern: /^usage$/,
    params: [],
    load: () => import('@/lib/server/api-routes/usage/handler'),
  },
  {
    pattern: /^v1\/classrooms\/([^/]+)\/external-card-drafts$/,
    params: [{ name: 'classroomId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/classrooms/[classroomId]/external-card-drafts/handler'),
  },
  {
    pattern: /^v1\/classrooms\/([^/]+)\/learning-events$/,
    params: [{ name: 'classroomId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/classrooms/[classroomId]/learning-events/handler'),
  },
  {
    pattern: /^v1\/classrooms\/([^/]+)\/writeback-drafts$/,
    params: [{ name: 'classroomId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/classrooms/[classroomId]/writeback-drafts/handler'),
  },
  {
    pattern: /^v1\/course-inputs$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/course-inputs/handler'),
  },
  {
    pattern: /^v1\/course-plans$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/course-plans/handler'),
  },
  {
    pattern: /^v1\/course-plans\/([^/]+)$/,
    params: [{ name: 'planningRunId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/course-plans/[planningRunId]/handler'),
  },
  {
    pattern: /^v1\/course-jobs$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/course-jobs/handler'),
  },
  {
    pattern: /^v1\/course-jobs\/([^/]+)$/,
    params: [{ name: 'jobId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/course-jobs/[jobId]/handler'),
  },
  {
    pattern: /^v1\/course-jobs\/([^/]+)\/advance$/,
    params: [{ name: 'jobId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/course-jobs/[jobId]/advance/handler'),
  },
  {
    pattern: /^v1\/deposition-policy$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/deposition-policy/handler'),
  },
  {
    pattern: /^v1\/device-tokens\/refresh$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/device-tokens/refresh/handler'),
  },
  {
    pattern: /^v1\/device-tokens\/revoke$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/device-tokens/revoke/handler'),
  },
  {
    pattern: /^v1\/integration-capabilities$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/integration-capabilities/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/diff$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/diff/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/feedback$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/feedback/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/nodes\/([^/]+)$/,
    params: [{ name: 'nodeId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/nodes/[nodeId]/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/nodes\/([^/]+)\/neighborhood$/,
    params: [{ name: 'nodeId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/knowledge-graphs/nodes/[nodeId]/neighborhood/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/path$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/path/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/projections$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/projections/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/projections\/([^/]+)$/,
    params: [{ name: 'projectionId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/knowledge-graphs/projections/[projectionId]/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/projections\/([^/]+)\/chunks$/,
    params: [{ name: 'projectionId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/knowledge-graphs/projections/[projectionId]/chunks/handler'),
  },
  {
    pattern: /^v1\/knowledge-graphs\/rebuild$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/knowledge-graphs/rebuild/handler'),
  },
  {
    pattern: /^v1\/learning-events\/batch$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/learning-events/batch/handler'),
  },
  {
    pattern: /^v1\/maintenance\/course-generation$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/maintenance/course-generation/handler'),
  },
  {
    pattern: /^v1\/maintenance\/knowledge-graph-refresh$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/maintenance/knowledge-graph-refresh/handler'),
  },
  {
    pattern: /^v1\/maintenance\/knowledge-graph-status$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/maintenance/knowledge-graph-status/handler'),
  },
  {
    pattern: /^v1\/maintenance\/source-retention$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/maintenance/source-retention/handler'),
  },
  {
    pattern: /^v1\/mastery$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/mastery/handler'),
  },
  {
    pattern: /^v1\/mastery\/rebuild$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/mastery/rebuild/handler'),
  },
  {
    pattern: /^v1\/pairing-sessions$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/pairing-sessions/handler'),
  },
  {
    pattern: /^v1\/pairing-sessions\/exchange$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/pairing-sessions/exchange/handler'),
  },
  {
    pattern: /^v1\/projects$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/projects/handler'),
  },
  {
    pattern: /^v1\/projects\/([^/]+)$/,
    params: [{ name: 'projectId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/projects/[projectId]/handler'),
  },
  {
    pattern: /^v1\/projects\/([^/]+)\/finalize-sync$/,
    params: [{ name: 'projectId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/projects/[projectId]/finalize-sync/handler'),
  },
  {
    pattern: /^v1\/projects\/([^/]+)\/learning-index$/,
    params: [{ name: 'projectId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/projects/[projectId]/learning-index/handler'),
  },
  {
    pattern: /^v1\/projects\/([^/]+)\/retrievals$/,
    params: [{ name: 'projectId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/projects/[projectId]/retrievals/handler'),
  },
  {
    pattern: /^v1\/product-health$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/product-health/handler'),
  },
  {
    pattern: /^v1\/reviews$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/reviews/handler'),
  },
  {
    pattern: /^v1\/reviews\/([^/]+)\/complete$/,
    params: [{ name: 'reviewItemId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/reviews/[reviewItemId]/complete/handler'),
  },
  {
    pattern: /^v1\/research-runs\/([^/]+)\/source-health$/,
    params: [{ name: 'researchRunId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/research-runs/[researchRunId]/source-health/handler'),
  },
  {
    pattern: /^v1\/source-bundles\/([^/]+)$/,
    params: [{ name: 'bundleId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/source-bundles/[bundleId]/handler'),
  },
  {
    pattern: /^v1\/source-bundles\/([^/]+)\/project-context$/,
    params: [{ name: 'bundleId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/source-bundles/[bundleId]/project-context/handler'),
  },
  {
    pattern: /^v1\/source-uploads$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/source-uploads/handler'),
  },
  {
    pattern: /^v1\/source-uploads\/([^/]+)$/,
    params: [{ name: 'bundleId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/source-uploads/[bundleId]/handler'),
  },
  {
    pattern: /^v1\/sprints\/([^/]+)\/complete$/,
    params: [{ name: 'sprintId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/sprints/[sprintId]/complete/handler'),
  },
  {
    pattern: /^v1\/syntheses$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/syntheses/handler'),
  },
  {
    pattern: /^v1\/syntheses\/([^/]+)$/,
    params: [{ name: 'synthesisId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/syntheses/[synthesisId]/handler'),
  },
  {
    pattern: /^v1\/syntheses\/([^/]+)\/diff\/([^/]+)$/,
    params: [
      { name: 'synthesisId', catchAll: false },
      { name: 'baselineId', catchAll: false },
    ],
    load: () =>
      import('@/lib/server/api-routes/v1/syntheses/[synthesisId]/diff/[baselineId]/handler'),
  },
  {
    pattern: /^v1\/syntheses\/([^/]+)\/writeback-drafts$/,
    params: [{ name: 'synthesisId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/syntheses/[synthesisId]/writeback-drafts/handler'),
  },
  {
    pattern: /^v1\/synthesis-schedules$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/synthesis-schedules/handler'),
  },
  {
    pattern: /^v1\/synthesis-schedules\/([^/]+)$/,
    params: [{ name: 'scheduleId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/synthesis-schedules/[scheduleId]/handler'),
  },
  {
    pattern: /^v1\/synthesis-schedules\/([^/]+)\/index-drafts$/,
    params: [{ name: 'scheduleId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/synthesis-schedules/[scheduleId]/index-drafts/handler'),
  },
  {
    pattern: /^v1\/synthesis-schedules\/run-due$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/synthesis-schedules/run-due/handler'),
  },
  {
    pattern: /^v1\/writeback-commands\/([^/]+)\/local-validation$/,
    params: [{ name: 'commandId', catchAll: false }],
    load: () =>
      import('@/lib/server/api-routes/v1/writeback-commands/[commandId]/local-validation/handler'),
  },
  {
    pattern: /^v1\/vault-overview\/writeback-drafts$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/vault-overview/writeback-drafts/handler'),
  },
  {
    pattern: /^v1\/writeback-commands\/pending$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/writeback-commands/pending/handler'),
  },
  {
    pattern: /^v1\/writeback-drafts\/([^/]+)\/approve$/,
    params: [{ name: 'draftId', catchAll: false }],
    load: () => import('@/lib/server/api-routes/v1/writeback-drafts/[draftId]/approve/handler'),
  },
  {
    pattern: /^v1\/writeback-receipts$/,
    params: [],
    load: () => import('@/lib/server/api-routes/v1/writeback-receipts/handler'),
  },
  {
    pattern: /^verify-image-provider$/,
    params: [],
    load: () => import('@/lib/server/api-routes/verify-image-provider/handler'),
  },
  {
    pattern: /^verify-model$/,
    params: [],
    load: () => import('@/lib/server/api-routes/verify-model/handler'),
  },
  {
    pattern: /^verify-pdf-provider$/,
    params: [],
    load: () => import('@/lib/server/api-routes/verify-pdf-provider/handler'),
  },
  {
    pattern: /^verify-video-provider$/,
    params: [],
    load: () => import('@/lib/server/api-routes/verify-video-provider/handler'),
  },
  {
    pattern: /^web-search$/,
    params: [],
    load: () => import('@/lib/server/api-routes/web-search/handler'),
  },
];
