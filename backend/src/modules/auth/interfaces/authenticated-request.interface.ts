import { Request } from 'express';
import { AuthenticatedUser } from './jwt-payload.interface';

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
