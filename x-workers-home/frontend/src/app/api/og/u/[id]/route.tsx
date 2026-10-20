import { getImageResponse } from '@/lib/og-image-response';
import {
  OG_HEIGHT,
  OG_WIDTH,
  isUuid,
  siteHost,
  textResponse,
  truncate,
} from '@/lib/og';
import { loadOgFonts, ogFontFamily } from '@/lib/og-font';
import { PublicApiError, getPublicJson } from '@/lib/public-api';
import {
  type PublicUser,
  type UserRatingSummary,
  fetchUserRating,
  formatJoined,
} from '@/lib/users';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  S: { bg: 'rgba(245, 158, 11, 0.22)', text: '#fcd34d' },
  A: { bg: 'rgba(16, 185, 129, 0.22)', text: '#6ee7b7' },
  B: { bg: 'rgba(14, 165, 233, 0.22)', text: '#7dd3fc' },
  C: { bg: 'rgba(148, 163, 184, 0.22)', text: '#cbd5e1' },
  D: { bg: 'rgba(244, 63, 94, 0.22)', text: '#fda4af' },
};

/** 个人主页分享图：评级 + 星级 + 完成数。 */
export async function GET(_request: Request, { params }: RouteContext) {
  if (!isUuid(params.id)) {
    return textResponse('无效的用户 ID', 400);
  }

  let profile: PublicUser;
  try {
    profile = await getPublicJson<PublicUser>(
      `/users/${params.id}/public`,
      '用户不存在',
    );
  } catch (err) {
    if (err instanceof PublicApiError) {
      return textResponse(err.message, err.status === 404 ? 404 : 502);
    }
    return textResponse('用户加载失败', 502);
  }

  // 星级均分是可选装饰：评价服务异常不影响主页分享图生成。
  let summary: UserRatingSummary | null = null;
  try {
    summary = await fetchUserRating(params.id);
  } catch {
    summary = null;
  }

  const fonts = await loadOgFonts();
  const fontFamily = ogFontFamily(fonts);
  const ImageResponse = await getImageResponse();

  const grade = profile.ratingGrade?.toUpperCase() ?? null;
  const gradeColor = grade ? GRADE_COLORS[grade] : undefined;
  const displayName = profile.handle ? `@${profile.handle}` : '未绑定 X 的用户';
  const initial = profile.handle ? profile.handle.slice(0, 1).toUpperCase() : 'X';
  const average = summary?.average ?? null;
  const filledStars = average !== null ? Math.round(average) : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          background: 'linear-gradient(135deg, #0f172a 0%, #312e81 55%, #4338ca 100%)',
          color: '#ffffff',
          fontFamily,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              background: '#6366f1',
              fontSize: 30,
            }}
          >
            X
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: '#c7d2fe' }}>
            X工作者之家
          </div>
          <div
            style={{
              display: 'flex',
              marginLeft: 'auto',
              padding: '10px 26px',
              borderRadius: 999,
              background: 'rgba(255, 255, 255, 0.14)',
              fontSize: 28,
              color: '#e0e7ff',
            }}
          >
            公开主页
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 52 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <div
                style={{
                  width: 96,
                  height: 96,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  background: 'rgba(255, 255, 255, 0.14)',
                  fontSize: 44,
                  color: '#e0e7ff',
                }}
              >
                {initial}
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 54,
                  maxWidth: 620,
                  overflow: 'hidden',
                }}
              >
                {truncate(displayName, 24)}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, fontSize: 26, color: '#c7d2fe' }}>
              <div style={{ display: 'flex' }}>入驻 {formatJoined(profile.joined)}</div>
              {profile.xBound ? (
                <div
                  style={{
                    display: 'flex',
                    padding: '4px 18px',
                    borderRadius: 999,
                    background: 'rgba(16, 185, 129, 0.2)',
                    color: '#6ee7b7',
                  }}
                >
                  X 已认证
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34 }}>
              {average !== null ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <div
                      key={star}
                      style={{ display: 'flex', color: star <= filledStars ? '#fbbf24' : '#64748b' }}
                    >
                      ★
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ display: 'flex', fontSize: 28, color: '#a5b4fc' }}>
                  暂无评价
                </div>
              )}
              {average !== null ? (
                <div style={{ display: 'flex', color: '#e0e7ff' }}>
                  {average.toFixed(1)}
                </div>
              ) : null}
              <div style={{ display: 'flex', fontSize: 26, color: '#a5b4fc' }}>
                完成 {profile.completedCount} 单
              </div>
            </div>
          </div>

          <div
            style={{
              width: 220,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '34px 20px',
              borderRadius: 28,
              background: gradeColor?.bg ?? 'rgba(255, 255, 255, 0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 96,
                color: gradeColor?.text ?? '#e2e8f0',
              }}
            >
              {grade ?? '—'}
            </div>
            <div style={{ display: 'flex', fontSize: 24, color: '#c7d2fe' }}>
              账户评级
            </div>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 24,
            color: '#a5b4fc',
          }}
        >
          <div style={{ display: 'flex' }}>连接 X 账号 · 承接任务 · 按约结算</div>
          <div style={{ display: 'flex' }}>{siteHost()}</div>
        </div>
      </div>
    ),
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: fonts.length ? fonts : undefined,
      headers: { 'cache-control': 'public, max-age=60, s-maxage=300' },
    },
  );
}
