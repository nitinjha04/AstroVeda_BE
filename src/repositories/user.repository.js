const { User } = require('../models');

class UserRepository {
  findById(id, opts = {}) {
    return User.findById(id).select(opts.select || undefined);
  }

  findOne(filter, opts = {}) {
    let q = User.findOne(filter);
    if (opts.select) q = q.select(opts.select);
    return q;
  }

  create(data) {
    return User.create(data);
  }

  updateById(id, data) {
    return User.findByIdAndUpdate(id, data, { new: true });
  }

  paginate(filter = {}, { page = 1, limit = 20, sort = { createdAt: -1 } } = {}) {
    const skip = (page - 1) * limit;
    return Promise.all([
      User.find(filter).sort(sort).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]).then(([items, total]) => ({
      items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    }));
  }
}

module.exports = new UserRepository();
