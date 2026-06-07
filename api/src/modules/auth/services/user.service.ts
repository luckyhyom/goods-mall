import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppException } from '../../../common/errors/app.exception';
import { PublicUserResponse } from '../dto/public-user.response';

/** 인증된 사용자 프로필 조회. */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  /** access 토큰 검증 후 현재 사용자 프로필 조회(/auth/me). */
  async getMe(userId: string): Promise<PublicUserResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      // 토큰은 유효하나 계정이 사라진 경우
      throw new AppException('UNAUTHORIZED');
    }
    return new PublicUserResponse(user);
  }
}
