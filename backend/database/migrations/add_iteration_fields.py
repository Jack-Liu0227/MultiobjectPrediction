"""
添加迭代预测字段到Task表

Revision ID: add_iteration_fields
Revises: 
Create Date: 2025-12-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import sqlite


# revision identifiers, used by Alembic.
revision = 'add_iteration_fields'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    """添加迭代预测相关字段"""
    
    # 添加迭代预测字段
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        # 基础迭代配置
        batch_op.add_column(sa.Column('enable_iteration', sa.Boolean(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('max_iterations', sa.Integer(), nullable=False, server_default='1'))
        batch_op.add_column(sa.Column('current_iteration', sa.Integer(), nullable=False, server_default='0'))
        batch_op.add_column(sa.Column('convergence_threshold', sa.Float(), nullable=False, server_default='0.01'))
        batch_op.add_column(sa.Column('early_stop', sa.Boolean(), nullable=False, server_default='1'))
        batch_op.add_column(sa.Column('max_workers', sa.Integer(), nullable=False, server_default='5'))
        
        # JSON字段
        batch_op.add_column(sa.Column('iteration_history', sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column('failed_samples', sa.JSON(), nullable=True))
        
        # 外键字段
        batch_op.add_column(sa.Column('continue_from_task_id', sa.String(36), nullable=True))
        
        # 添加外键约束
        batch_op.create_foreign_key(
            'fk_continue_from_task',
            'tasks',
            ['continue_from_task_id'],
            ['task_id']
        )
        
        # 添加检查约束
        batch_op.create_check_constraint(
            'check_max_iterations',
            'max_iterations >= 1 AND max_iterations <= 10'
        )
        batch_op.create_check_constraint(
            'check_convergence_threshold',
            'convergence_threshold >= 0.001 AND convergence_threshold <= 0.1'
        )
        batch_op.create_check_constraint(
            'check_max_workers',
            'max_workers >= 1 AND max_workers <= 20'
        )


def downgrade():
    """移除迭代预测相关字段"""
    
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        # 移除外键约束
        batch_op.drop_constraint('fk_continue_from_task', type_='foreignkey')
        
        # 移除检查约束
        batch_op.drop_constraint('check_max_iterations', type_='check')
        batch_op.drop_constraint('check_convergence_threshold', type_='check')
        batch_op.drop_constraint('check_max_workers', type_='check')
        
        # 移除列
        batch_op.drop_column('continue_from_task_id')
        batch_op.drop_column('failed_samples')
        batch_op.drop_column('iteration_history')
        batch_op.drop_column('max_workers')
        batch_op.drop_column('early_stop')
        batch_op.drop_column('convergence_threshold')
        batch_op.drop_column('current_iteration')
        batch_op.drop_column('max_iterations')
        batch_op.drop_column('enable_iteration')

