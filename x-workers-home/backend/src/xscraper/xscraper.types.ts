/**
 * x.py 输出里 user / tweet 的归一化形状。
 * 上游 user_out() / tweet_out() 会用 clean() 丢掉 null 与空值，所以除 id/handle 外字段都可能缺席。
 */

export interface XAbout {
  based_in?: string;
  /** false = X 提示所在地可能不准（比如用了 VPN） */
  based_in_accurate?: boolean;
  signed_up_via?: string;
  signup_country_accurate?: boolean;
  username_changes?: number;
  last_username_change?: string;
}

export interface XUserSummary {
  handle: string;
  name?: string;
  id?: string;
  followers?: number | null;
  following?: number | null;
  verified?: boolean;
  verified_type?: string;
  protected?: boolean;
}

export interface XUser extends XUserSummary {
  bio?: string;
  location?: string;
  website?: string;
  tweets?: number | null;
  likes?: number | null;
  media_count?: number | null;
  joined?: string | null;
  avatar?: string;
  banner?: string;
  url?: string;
  about?: XAbout;
}

export interface XMedia {
  type?: string;
  url?: string;
  thumb?: string;
  seconds?: number;
}

export interface XPollChoice {
  label?: string;
  votes?: number;
  percent?: number;
}

export interface XArticle {
  title?: string;
  preview?: string;
  text?: string;
  note?: string;
  truncated?: boolean;
}

export interface XReplyTo {
  handle?: string;
  id?: string;
}

export interface XTweet {
  id: string;
  url?: string;
  created_at?: string | null;
  author?: XUserSummary;
  text?: string | null;
  lang?: string;
  views?: number | null;
  likes?: number | null;
  reposts?: number | null;
  quotes?: number | null;
  replies?: number | null;
  bookmarks?: number | null;
  reply_to?: XReplyTo;
  reposted_by?: string;
  media?: XMedia[];
  community_note?: string;
  poll?: XPollChoice[];
  sensitive?: boolean;
  article?: XArticle;
  quoted?: XTweet;
}
