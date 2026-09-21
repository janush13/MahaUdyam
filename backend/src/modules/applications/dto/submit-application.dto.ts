import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

/** Body of `POST …/applications/:applicationId/submit`. */
export class SubmitApplicationDto {
  @ApiProperty({
    enum: [true],
    description:
      'The mandatory declaration (FRD §17.2), affirmed by the caller. Must be exactly true. The declaration wording is shown by the client and is legal content still to be supplied by the department.',
  })
  @IsBoolean()
  @Equals(true, { message: 'declarationAccepted must be true to submit' })
  declarationAccepted: boolean;
}
