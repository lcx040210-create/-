import { ORDER_TYPE_LABEL, type OrderDetailView } from '@/lib/orders';
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

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: { id: string };
}

interface Stat {
  label: string;
  value: string;
  accent?: boolean;
}

/** 商单分享图：类型 / 标题 / 单价 / 到手 / 剩余名额。 */
export async function GET(_request: Request, { params }: RouteContext) {
  if (!isUuid(params.id)) {
    return textResponse('无效的商单 ID', 400);
  }

  let order: OrderDetailView;
  try {
    order = await getPublicJson<OrderDetailView>(`/orders/${params.id}`, '商单不存在');
  } catch (err) {
    if (err instanceof PublicApiError) {
      return textResponse(err.message, err.status === 404 ? 404 : 502);
    }
    return textResponse('商单加载失败', 502);
  }

  const fonts = await loadOgFonts();
  const fontFamily = ogFontFamily(fonts);
  const ImageResponse = await getImageResponse();

  const typeLabel = ORDER_TYPE_LABEL[order.type] ?? order.type;
  const stats: Stat[] = [
    { label: '单价', value: `${order.priceXm} XM` },
    { label: '接单到手', value: `${order.payoutXm} XM`, accent: true },
    {
      label: '剩余名额',
      value: order.slotsAvailable > 0 ? `${order.slotsAvailable}/${order.slotsTotal}` : '已满',
    },
  ];

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
              fontWeight: 700,
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
            {typeLabel}商单
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 44 }}>
          <div
            style={{
              display: 'flex',
              fontSize: 64,
              lineHeight: 1.25,
              maxHeight: 160,
              overflow: 'hidden',
            }}
          >
            {truncate(order.title, 36)}
          </div>

          <div style={{ display: 'flex', gap: 22 }}>
            {stats.map((stat) => (
              <div
                key={stat.label}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '24px 28px',
                  borderRadius: 20,
                  background: stat.accent
                    ? 'rgba(16, 185, 129, 0.18)'
                    : 'rgba(255, 255, 255, 0.1)',
                }}
              >
                <div style={{ display: 'flex', fontSize: 24, color: '#c7d2fe' }}>
                  {stat.label}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: 42,
                    color: stat.accent ? '#6ee7b7' : '#ffffff',
                  }}
                >
                  {stat.value}
                </div>
              </div>
            ))}
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
          <div style={{ display: 'flex' }}>接单做任务 · 自动核验 · 按约结算</div>
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
