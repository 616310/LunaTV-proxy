import { NextRequest } from 'next/server';

type RuntimeConfigWindow = Window & {
  RUNTIME_CONFIG?: {
    OWNER_USERNAME?: string;
    SITE_OWNER?: string;
  };
};

const authDisabledFlag =
  (process.env.NEXT_PUBLIC_AUTH_DISABLED ||
    process.env.AUTH_DISABLED ||
    ''
  ).toLowerCase();
const AUTH_DISABLED =
  authDisabledFlag === 'true' || authDisabledFlag === '1';

function getServerOwnerUsername(): string {
  return process.env.USERNAME || 'owner';
}

function getClientOwnerUsername(): string {
  if (typeof window !== 'undefined') {
    const runtimeWindow = window as RuntimeConfigWindow;
    return (
      runtimeWindow.RUNTIME_CONFIG?.OWNER_USERNAME ||
      runtimeWindow.RUNTIME_CONFIG?.SITE_OWNER ||
      'owner'
    );
  }

  return (
    process.env.NEXT_PUBLIC_OWNER_USERNAME ||
    process.env.NEXT_PUBLIC_DEFAULT_USER ||
    'owner'
  );
}

function buildPublicAuthInfo(
  username: string
): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} {
  return {
    username,
    role: 'owner',
    timestamp: Date.now(),
  };
}

export function isAuthDisabled(): boolean {
  return AUTH_DISABLED;
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return AUTH_DISABLED ? buildPublicAuthInfo(getServerOwnerUsername()) : null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    if (AUTH_DISABLED) {
      return buildPublicAuthInfo(getServerOwnerUsername());
    }
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return AUTH_DISABLED
        ? buildPublicAuthInfo(getClientOwnerUsername())
        : null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    if (AUTH_DISABLED) {
      return buildPublicAuthInfo(getClientOwnerUsername());
    }
    return null;
  }
}
