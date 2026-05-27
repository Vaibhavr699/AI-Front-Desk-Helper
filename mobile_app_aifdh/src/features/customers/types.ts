export type CreateCustomerInput = {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  project_type?: string;
  estimated_value?: number;
  source?: string;
  notes?: string;
};

export type UpdateCustomerInput = {
  name?: string;
  email?: string;
  address?: string;
  project_type?: string;
  notes?: string;
  estimated_value?: number;
  status?: string;
};
