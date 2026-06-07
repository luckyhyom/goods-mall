import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TokenService } from './token.service';
import { LocalAuthService } from './services/local-auth.service';
import { OAuthLinkService } from './services/oauth-link.service';
import { UserService } from './services/user.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleCallbackGuard } from './guards/google-callback.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';

/**
 * 인증 모듈. 토큰 발급/검증의 단일 책임자(TokenService)를 제공한다.
 * JwtModule 은 빈 설정으로 등록하고, 시크릿/TTL 은 TokenService 가
 * 발급 시점에 env 로부터 명시적으로 주입한다(검증 가드도 동일 시크릿 사용).
 */
@Module({
  imports: [JwtModule.register({}), PassportModule],
  controllers: [AuthController],
  providers: [
    TokenService,
    LocalAuthService,
    OAuthLinkService,
    UserService,
    GoogleStrategy,
    GoogleCallbackGuard,
    JwtAuthGuard,
    AdminGuard,
  ],
  // 다른 슬라이스가 보호 엔드포인트에 재사용
  exports: [TokenService, JwtAuthGuard, AdminGuard, JwtModule],
})
export class AuthModule {}
