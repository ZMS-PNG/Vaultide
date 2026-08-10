import { describe, expect, it } from 'vitest';
import {
  deriveLearningNextAction,
  learningVerificationSnapshot,
  parseLearningVerificationSnapshot,
} from '@/lib/learning/domain/learning-next-action';

describe('learning next action', () => {
  it('treats generation completion as published content, not completed learning', () => {
    const action = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: false,
      totalScenes: 10,
      viewedSceneCount: 0,
      evidenceCount: 0,
      masteryEstimate: null,
      masteryConfidence: 0,
      transferEvidencePassed: false,
    });

    expect(action).toMatchObject({
      phase: 'content-ready',
      statusLabel: '课程已发布，学习尚未验证',
      learningVerified: false,
      canCreateDraft: true,
      canPublishSynthesis: false,
      canApproveWriteback: false,
    });
  });

  it('does not turn manual scene browsing into verified learning', () => {
    const action = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: false,
      totalScenes: 10,
      viewedSceneCount: 10,
      evidenceCount: 0,
      masteryEstimate: null,
      masteryConfidence: 0,
      transferEvidencePassed: false,
    });

    expect(action).toMatchObject({
      phase: 'transfer-check',
      learningVerified: false,
      primaryActionLabel: '完成最终迁移检验',
    });
  });

  it('requires a passing transfer result and a strong evidence floor', () => {
    const withoutTransfer = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: false,
      totalScenes: 10,
      viewedSceneCount: 10,
      evidenceCount: 5,
      masteryEstimate: 0.9,
      masteryConfidence: 0.8,
      transferEvidencePassed: false,
    });
    const weakEvidence = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: false,
      totalScenes: 10,
      viewedSceneCount: 10,
      evidenceCount: 2,
      masteryEstimate: 0.9,
      masteryConfidence: 0.8,
      transferEvidencePassed: true,
    });

    expect(withoutTransfer.learningVerified).toBe(false);
    expect(weakEvidence.learningVerified).toBe(false);
  });

  it('unlocks formal synthesis and writeback only after learning is verified', () => {
    const action = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: true,
      totalScenes: 10,
      viewedSceneCount: 10,
      evidenceCount: 4,
      masteryEstimate: 0.86,
      masteryConfidence: 0.62,
      transferEvidencePassed: true,
    });

    expect(action).toMatchObject({
      phase: 'verified',
      statusLabel: '学习已验证',
      learningVerified: true,
      canPublishSynthesis: true,
      canApproveWriteback: true,
    });
  });

  it('round-trips the browser verification snapshot without inventing state', () => {
    const action = deriveLearningNextAction({
      coursePublished: true,
      serverVerified: true,
      totalScenes: 9,
      viewedSceneCount: 9,
      evidenceCount: 3,
      masteryEstimate: 0.82,
      masteryConfidence: 0.55,
      transferEvidencePassed: true,
    });
    const snapshot = learningVerificationSnapshot(action, {
      viewedSceneCount: 9,
      totalScenes: 9,
      evidenceCount: 3,
    });

    expect(parseLearningVerificationSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseLearningVerificationSnapshot('{"learningVerified":true}')).toBeNull();
  });
});
