import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { AuthService, type GoogleProfile } from './auth.service';
import { TokenService } from './token.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { LinkDto } from './dto/link.dto';
import { JwtAuthGuard, type JwtPayload } from './guards/jwt-auth.guard';
import {
  GoogleCallbackGuard,
  OAUTH_FAILED,
  type OAuthFailure,
} from './guards/google-callback.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto); // 201 (POST 기본)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.tokens.rotate(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.tokens.revoke(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    return { user: await this.auth.getMe(user.sub) };
  }

  /** Google 인증 페이지로 302 리디렉트 (가드가 처리, 핸들러 바디는 비움). */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleAuth(): void {
    // passport-google가 인증 페이지로 리다이렉트
  }

  /**
   * Google 콜백. 분기 결과에 따라 fragment(로그인) 또는 ?pending(연결) redirect.
   * 토큰을 URL fragment로 전달하는 이유는 auth-strategy §5 참고(서버·referer 미전송).
   */
  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = req.user as GoogleProfile | OAuthFailure;
    const base = process.env.WEB_BASE_URL ?? '';

    // state 불일치·미검증 이메일 등 인증 실패 → 프런트 에러 페이지로 redirect
    if (OAUTH_FAILED in user) {
      res.redirect(`${base}/auth/oauth-error`);
      return;
    }

    const outcome = await this.auth.handleGoogleLogin(user);

    if (outcome.kind === 'authenticated') {
      const { accessToken, refreshToken } = outcome.result;
      res.redirect(
        `${base}/auth/oauth-success#accessToken=${accessToken}&refreshToken=${refreshToken}`,
      );
      return;
    }
    res.redirect(
      `${base}/auth/link?pending=${encodeURIComponent(outcome.pendingToken)}`,
    );
  }

  /** LOCAL 계정에 OAuth 연결 — pending JWT + 기존 패스워드 확인. */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  link(@Body() dto: LinkDto) {
    return this.auth.link(dto);
  }
}
